import { afterEach, describe, expect, test, vi } from "vitest";
import {
  legacyOpenAiConnectionFromSettings,
  requestOpenAiCompatibleTask,
  resetOpenAiCompatibilityCacheForTests,
  resolveOpenAiCompatibilityPreset,
} from "../src/shared/llm/openAiCompatible";
import {
  sanitizeTranslatorSettings,
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

  test("custom endpoints negotiate schema to object and cache the accepted mode", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let rejectedSchemaOnce = false;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const responseFormat = body.response_format as { type?: string } | undefined;
      if (!rejectedSchemaOnce && responseFormat?.type === "json_schema") {
        rejectedSchemaOnce = true;
        return http({ error: { message: "json_schema response_format unsupported" } }, 400);
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
