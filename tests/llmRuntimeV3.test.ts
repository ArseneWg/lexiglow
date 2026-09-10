
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  analyzeSentenceWithLlm,
  parseSentenceAnalysisResponse,
  sanitizeTranslatorSettings,
  translateSelectionWithLlm,
} from "../src/shared/translator";
import { resolveLlmExecutionPolicy } from "../src/shared/llm/runtime";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function responsesPayload(content: unknown) {
  return {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(content) }] }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LLM runtime v3", () => {
  test("migrates legacy provider guesses once at the storage boundary", () => {
    expect(sanitizeTranslatorSettings({
      llmProvider: "openai",
      providerBaseUrl: "https://api.deepseek.com",
      providerModel: "deepseek-v4-flash",
    }).llmProvider).toBe("deepseek");
    expect(sanitizeTranslatorSettings({
      llmProvider: "openai",
      providerBaseUrl: "https://gpustack.example/v1",
      providerModel: "local",
    }).llmProvider).toBe("openai-compatible");
    expect(sanitizeTranslatorSettings({ llmProvider: "claude" }).llmProvider).toBe("anthropic");
  });

  test("official providers use canonical endpoints while custom compatible endpoints stay editable", () => {
    expect(sanitizeTranslatorSettings({
      llmProvider: "deepseek",
      providerBaseUrl: "https://proxy.invalid/v1",
    }).providerBaseUrl).toBe("https://api.deepseek.com");
    expect(sanitizeTranslatorSettings({
      llmProvider: "openai-compatible",
      providerBaseUrl: "http://localhost:9999/v1",
    }).providerBaseUrl).toBe("http://localhost:9999/v1");
  });

  test("runtime owns dynamic long-selection and sentence-analysis budgets", () => {
    expect(resolveLlmExecutionPolicy("selection-translation", "short text").maxTokens).toBe(180);
    expect(resolveLlmExecutionPolicy("selection-translation", "dense technical text ".repeat(50)).maxTokens).toBeGreaterThan(180);
    const complex = resolveLlmExecutionPolicy("sentence-analysis", "Although the measurements were inconsistent, the researchers who repeated the experiment carefully found that the pattern remained stable because calibration had changed.");
    expect(complex.reasoning).toBe("high");
    expect(complex.maxTokens).toBe(6000);
  });

  test("DeepSeek is selected explicitly and uses its native Responses API", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return response(responsesPayload({ word: "完整翻译" }));
    }));
    const result = await translateSelectionWithLlm({
      text: "A long sentence to translate.",
      contextText: "A long sentence to translate.",
      settings: sanitizeTranslatorSettings({
        llmProvider: "deepseek",
        providerModel: "deepseek-v4-flash",
        apiKey: "dummy",
      }),
    });
    expect(result.translation).toBe("完整翻译");
    expect(url).toBe("https://api.deepseek.com/responses");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body).not.toHaveProperty("instructions");
    expect(body.input).toEqual([
      expect.objectContaining({ role: "system", content: expect.any(String) }),
      expect.objectContaining({ role: "user", content: expect.any(String) }),
    ]);
    expect(body.text).toMatchObject({ format: { type: "json_schema", name: "lexiglow_selection_translation" } });
  });

  test("OpenAI uses Responses API with storage disabled", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return response(responsesPayload({ word: "翻译" }));
    }));
    await translateSelectionWithLlm({
      text: "translation",
      contextText: "translation",
      settings: sanitizeTranslatorSettings({ llmProvider: "openai", apiKey: "dummy" }),
    });
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body.store).toBe(false);
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
  });

  test("Gemini uses the Interactions API with structured output", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return response({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: '{"word":"翻译"}' }] }] });
    }));
    await translateSelectionWithLlm({
      text: "translation",
      contextText: "translation",
      settings: sanitizeTranslatorSettings({ llmProvider: "gemini", apiKey: "dummy" }),
    });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
  });

  test("Anthropic uses native Messages structured output", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return response({ stop_reason: "end_turn", content: [{ type: "text", text: '{"word":"翻译"}' }] });
    }));
    await translateSelectionWithLlm({
      text: "translation",
      contextText: "translation",
      settings: sanitizeTranslatorSettings({ llmProvider: "anthropic", apiKey: "dummy" }),
    });
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  test("sentence analysis reconstructs exact source text from token decisions", () => {
    const sentence = "Although the model failed, the model recovered.";
    const result = parseSentenceAnalysisResponse(JSON.stringify({
      translation: "虽然模型失败了，但模型恢复了。",
      structure: "the model recovered",
      analysisSteps: ["一", "二", "三", "四"],
      highlights: [
        { category: "subject", tokenIndex: 5 },
        { category: "predicate", tokenIndex: 6 },
      ],
      clauseBlocks: [
        { type: "subordinate", startToken: 0, endToken: 3 },
        { type: "main", startToken: 4, endToken: 6 },
      ],
    }), sentence);
    expect(result.highlights[0]).toMatchObject({ text: "model", tokenIndex: 5 });
    expect(result.clauseBlocks.map((item) => item.text)).toEqual([
      "Although the model failed,",
      "the model recovered.",
    ]);
  });

  test("sentence analysis rejects clause gaps instead of fuzzy-matching copied text", () => {
    const sentence = "Although the model failed, the team recovered.";
    expect(() => parseSentenceAnalysisResponse(JSON.stringify({
      translation: "译文",
      structure: "team recovered",
      analysisSteps: ["一", "二", "三", "四"],
      highlights: [{ category: "subject", tokenIndex: 5 }],
      clauseBlocks: [
        { type: "subordinate", startToken: 0, endToken: 3 },
        { type: "main", startToken: 5, endToken: 6 },
      ],
    }), sentence)).toThrow(/gap or overlap/i);
  });

  test("invalid first sentence analysis receives exact validation feedback on one quality retry", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const valid = {
        translation: "尽管实验失败，团队仍继续。",
        structure: "team continued",
        analysisSteps: ["一", "二", "三", "四"],
        highlights: [
          { category: "conjunction", tokenIndex: 0 },
          { category: "subject", tokenIndex: 5 },
          { category: "predicate", tokenIndex: 6 },
        ],
        clauseBlocks: [
          { type: "subordinate", startToken: 0, endToken: 3 },
          { type: "main", startToken: 4, endToken: 6 },
        ],
      };
      if (bodies.length === 1) {
        return response(responsesPayload({ ...valid, clauseBlocks: [{ type: "main", startToken: 1, endToken: 6 }] }));
      }
      return response(responsesPayload(valid));
    }));
    const result = await analyzeSentenceWithLlm({
      text: "Although the experiment failed, the team continued.",
      settings: sanitizeTranslatorSettings({ llmProvider: "deepseek", apiKey: "dummy" }),
    });
    expect(result.translation).toContain("团队");
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("must start at token 0");
    expect((bodies[1].reasoning as { effort?: string }).effort).toBe("high");
  });
});
