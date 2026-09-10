import { afterEach, describe, expect, test, vi } from "vitest";
import {
  legacyOpenAiConnectionFromSettings,
  requestOpenAiCompatibleTask,
  resetOpenAiCompatibilityCacheForTests,
  resolveOpenAiCompatibilityPreset,
} from "../src/shared/llm/openAiCompatible";
import {
  analyzeSentenceWithLlm,
  sanitizeTranslatorSettings,
  translateSelectionWithLlm,
  translateWithLlm,
} from "../src/shared/translator";

function http(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completion(content: string, finishReason = "stop") {
  return { choices: [{ message: { content }, finish_reason: finishReason }] };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetOpenAiCompatibilityCacheForTests();
});

describe("OpenAI-compatible v2", () => {
  test("classifies official and compatible endpoints", () => {
    expect(resolveOpenAiCompatibilityPreset("https://api.openai.com/v1")).toBe("openai");
    expect(resolveOpenAiCompatibilityPreset("https://api.deepseek.com")).toBe("deepseek");
    expect(resolveOpenAiCompatibilityPreset("https://gpustack.example/v1")).toBe("custom");
  });

  test("DeepSeek quick tasks use JSON mode with thinking disabled and no sampling knobs", async () => {
    let url = "";
    let init: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      url = String(input);
      init = requestInit;
      return http(completion('{"word":"预测"}'));
    }));

    const result = await requestOpenAiCompatibleTask({
      connection: legacyOpenAiConnectionFromSettings({
        providerBaseUrl: "https://api.deepseek.com",
        providerModel: "deepseek-v4-flash",
        apiKey: "dummy-key",
      }),
      task: "selection-translation",
      systemPrompt: "Translate precisely.",
      userPrompt: "selected_text: predictions",
      maxTokens: 180,
      timeoutMs: 5000,
    });

    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(result.structuredOutputMode).toBe("json-object");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.messages[0].content).toContain("JSON example");
    expect((init?.headers as Record<string, string>).Authorization).toContain("dummy-key");
  });

  test("translateWithLlm consumes the DeepSeek response end to end", async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
      });
      if (url.includes("kaikki.org")) {
        return new Response("", { status: 404 });
      }
      if (url === "https://api.deepseek.com/chat/completions") {
        return http(completion(JSON.stringify({
          word: "预测",
          pos: "noun",
          hint: "此处表示模型给出的预测结果",
        })));
      }
      return new Response("", { status: 404 });
    }));

    const settings = sanitizeTranslatorSettings({
      defaultTranslationProvider: "llm",
      llmProvider: "openai",
      providerBaseUrl: "https://api.deepseek.com",
      providerModel: "deepseek-v4-flash",
      apiKey: "dummy-key",
      fallbackToGoogle: false,
      learnerLanguageCode: "zh-CN",
      llmDisplayMode: "word",
    });
    const result = await translateWithLlm({
      surface: "predictions",
      contextText: "The model makes predictions about future demand.",
      settings,
      responseMode: "word",
    });

    expect(result.translation).toBe("预测");
    expect(result.contextualPartOfSpeech).toBe("n.");
    expect(result.semanticHint).toContain("模型");
    const deepSeekRequest = requests.find((item) => item.url === "https://api.deepseek.com/chat/completions");
    expect(deepSeekRequest?.body?.thinking).toEqual({ type: "disabled" });
    expect(deepSeekRequest?.body?.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(deepSeekRequest?.body)).not.toContain('"alternatives"');
  });

  test("DeepSeek sentence analysis enables only low reasoning", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return http(completion(JSON.stringify({
        translation: "译文",
        structure: "Models improve.",
        analysisSteps: ["一", "二", "三", "四"],
        highlights: [{ category: "subject", text: "Models", tokenIndex: 0 }],
        clauseBlocks: ["main|||Models improve."],
      })));
    }));

    await requestOpenAiCompatibleTask({
      connection: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "dummy",
        preset: "deepseek",
      },
      task: "sentence-analysis",
      systemPrompt: "Analyze.",
      userPrompt: "sentence: Models improve.",
      maxTokens: 1600,
      timeoutMs: 5000,
    });

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("low");
    expect(body.temperature).toBeUndefined();
  });

  test("official OpenAI uses strict JSON Schema and max_completion_tokens", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return http(completion('{"word":"预测"}'));
    }));

    await requestOpenAiCompatibleTask({
      connection: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "dummy",
        preset: "openai",
      },
      task: "selection-translation",
      systemPrompt: "Translate.",
      userPrompt: "predictions",
      maxTokens: 180,
      timeoutMs: 5000,
    });

    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "lexiglow_selection_translation", strict: true },
    });
    expect(body.max_completion_tokens).toBe(180);
    expect(body.max_tokens).toBeUndefined();
  });

  test("custom endpoints negotiate plaintext schema errors to object mode and cache the accepted mode", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let rejectedSchemaOnce = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const responseFormat = body.response_format as { type?: string } | undefined;
      if (!rejectedSchemaOnce && responseFormat?.type === "json_schema") {
        rejectedSchemaOnce = true;
        return new Response("response_format json_schema unsupported by this gateway", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return http(completion('{"word":"预测"}'));
    }));

    const request = {
      connection: {
        baseUrl: "https://gpustack.example/v1",
        model: "local-model",
        apiKey: "",
        preset: "custom" as const,
      },
      task: "selection-translation" as const,
      systemPrompt: "Translate.",
      userPrompt: "predictions",
      maxTokens: 180,
      timeoutMs: 5000,
    };

    const first = await requestOpenAiCompatibleTask(request);
    expect(first.structuredOutputMode).toBe("json-object");
    expect(bodies).toHaveLength(2);

    bodies.length = 0;
    await requestOpenAiCompatibleTask(request);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
  });

  test("custom endpoints can fall back to prompt-only JSON", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length <= 2) {
        return http({ error: { message: "response_format unsupported" } }, 400);
      }
      return http(completion('```json\n{"word":"预测"}\n```'));
    }));

    const result = await requestOpenAiCompatibleTask({
      connection: {
        baseUrl: "http://localhost:8080/v1",
        model: "local",
        apiKey: "",
        preset: "custom",
      },
      task: "selection-translation",
      systemPrompt: "Translate.",
      userPrompt: "predictions",
      maxTokens: 180,
      timeoutMs: 5000,
    });

    expect(result.structuredOutputMode).toBe("prompt-json");
    expect(result.content).toBe('{"word":"预测"}');
    expect(bodies[2].response_format).toBeUndefined();
  });

  test("contextual task contracts reject responses missing required POS or hint fields", async () => {
    const cases = [
      ["contextual-word", { word: "预测" }],
      ["contextual-word-sentence", { word: "预测", sentence: "这些预测与基准一致。" }],
      ["contextual-word-english", { word: "预测", english: "A guess about the future." }],
    ] as const;

    for (const [task, incomplete] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => http(completion(JSON.stringify(incomplete)))));
      await expect(requestOpenAiCompatibleTask({
        connection: {
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKey: "dummy",
          preset: "deepseek",
        },
        task,
        systemPrompt: "Return the requested fields.",
        userPrompt: "predictions",
        maxTokens: 180,
        timeoutMs: 5000,
      })).rejects.toThrow(/task contract/i);
    }
  });

  test("long DeepSeek selection translation expands the visible output budget", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return http(completion('{"word":"长句译文"}'));
    }));

    const text = "A technically dense sentence with multiple dependent clauses and detailed qualifications. ".repeat(8);
    const result = await translateSelectionWithLlm({
      text,
      contextText: text,
      settings: sanitizeTranslatorSettings({
        llmProvider: "openai",
        providerBaseUrl: "https://api.deepseek.com",
        providerModel: "deepseek-v4-flash",
        apiKey: "dummy",
        learnerLanguageCode: "zh-CN",
      }),
    });

    expect(result.translation).toBe("长句译文");
    expect(Number(body.max_tokens)).toBeGreaterThan(180);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  test("DeepSeek sentence analysis uses high reasoning for complex sentences", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return http(completion(JSON.stringify({
        translation: "完整译文",
        structure: "Researchers found evidence.",
        analysisSteps: ["一", "二", "三", "四"],
        highlights: [
          { category: "subject", text: "researchers", tokenIndex: 4 },
          { category: "predicate", text: "found", tokenIndex: 7 },
          { category: "conjunction", text: "Although", tokenIndex: 0 },
        ],
        clauseBlocks: [
          "subordinate|||Although the initial measurements appeared inconsistent,",
          "main|||the researchers who repeated the experiment carefully found that the underlying pattern remained stable,",
          "subordinate|||because the apparent discrepancy was caused by a calibration issue rather than a failure of the model.",
        ],
      })));
    }));

    const sentence = "Although the initial measurements appeared inconsistent, the researchers who repeated the experiment carefully found that the underlying pattern remained stable, because the apparent discrepancy was caused by a calibration issue rather than a failure of the model.";
    await analyzeSentenceWithLlm({
      text: sentence,
      settings: sanitizeTranslatorSettings({
        llmProvider: "openai",
        providerBaseUrl: "https://api.deepseek.com",
        providerModel: "deepseek-v4-flash",
        apiKey: "dummy",
        learnerLanguageCode: "zh-CN",
      }),
    });

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(Number(body.max_tokens)).toBeGreaterThanOrEqual(6000);
  });

  test("empty DeepSeek analysis output retries once with higher reasoning and budget", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) return http(completion(""));
      return http(completion(JSON.stringify({
        translation: "尽管实验失败，团队仍决定继续，因为证据仍然有用。",
        structure: "the team decided to continue",
        analysisSteps: ["一", "二", "三", "四"],
        highlights: [
          { category: "conjunction", text: "Although", tokenIndex: 0 },
          { category: "subject", text: "team", tokenIndex: 5 },
          { category: "predicate", text: "decided", tokenIndex: 7 },
        ],
        clauseBlocks: [
          "subordinate|||Although the experiment failed,",
          "main|||the team still decided to continue",
          "subordinate|||because the evidence remained useful.",
        ],
      })));
    }));

    const result = await analyzeSentenceWithLlm({
      text: "Although the experiment failed, the team still decided to continue because the evidence remained useful.",
      settings: sanitizeTranslatorSettings({
        llmProvider: "openai",
        providerBaseUrl: "https://api.deepseek.com",
        providerModel: "deepseek-v4-flash",
        apiKey: "dummy",
        learnerLanguageCode: "zh-CN",
      }),
    });

    expect(result.translation).toContain("团队");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[1].reasoning_effort).toBe("high");
    expect(Number(bodies[1].max_tokens)).toBeGreaterThan(Number(bodies[0].max_tokens));
  });

  test("truncated or malformed structured output fails closed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => http(completion('{"word":"半截', "length"))));
    await expect(requestOpenAiCompatibleTask({
      connection: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "dummy",
        preset: "deepseek",
      },
      task: "selection-translation",
      systemPrompt: "Translate.",
      userPrompt: "x",
      maxTokens: 8,
      timeoutMs: 5000,
    })).rejects.toThrow(/truncated/i);

    vi.stubGlobal("fetch", vi.fn(async () => http(completion('{"word":"半截'))));
    await expect(requestOpenAiCompatibleTask({
      connection: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKey: "dummy",
        preset: "deepseek",
      },
      task: "selection-translation",
      systemPrompt: "Translate.",
      userPrompt: "x",
      maxTokens: 180,
      timeoutMs: 5000,
    })).rejects.toThrow(/valid JSON/i);
  });
});
