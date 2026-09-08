import { afterEach, describe, expect, test, vi } from "vitest";

import {
  analyzeSentenceWithLlm,
  DEFAULT_TRANSLATOR_SETTINGS,
  translateSelectionWithLlm,
} from "../src/shared/translator";

function openAiResponse(content: unknown) {
  return new Response(JSON.stringify({
    choices: [
      {
        message: { content: typeof content === "string" ? content : JSON.stringify(content) },
        finish_reason: "stop",
      },
    ],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const localSettings = {
  ...DEFAULT_TRANSLATOR_SETTINGS,
  defaultTranslationProvider: "llm" as const,
  llmProvider: "openai" as const,
  providerBaseUrl: "http://localhost:8080/v1",
  providerModel: "local-model",
  apiKey: "",
};

describe("learning translation behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("keeps the complete selected source separate from capped surrounding context", async () => {
    const selected = `${"This selected source must remain complete. ".repeat(12)}TAIL_MARKER`;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const userPrompt = body.messages.find((message) => message.role === "user")?.content ?? "";

      expect(userPrompt).toContain("TAIL_MARKER");
      expect(userPrompt).toContain("selected_text:");
      return openAiResponse({ word: "完整译文" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateSelectionWithLlm({
      text: selected,
      contextText: `${selected} surrounding context that may be capped`,
      settings: localSettings,
    });

    expect(result.translation).toBe("完整译文");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("retries structurally incomplete sentence analysis and returns indexed highlights", async () => {
    const sentence = "The model handles difficult sentences with clear structure.";
    const first = {
      translation: "模型处理长难句。",
      structure: "model handles sentences",
      analysisSteps: ["切分。", "找主干。", "看修饰。", "按语序翻译。"],
      highlights: [{ category: "predicate", text: "handles", tokenIndex: 2 }],
      clauseBlocks: ["main|||The model"],
    };
    const second = {
      translation: "该模型能以清晰的结构处理复杂句子。",
      structure: "model handles sentences",
      analysisSteps: ["先按结构切分。", "主干是 model handles sentences。", "with clear structure 是方式修饰。", "先译主干再补修饰。"],
      highlights: [
        { category: "subject", text: "model", tokenIndex: 1 },
        { category: "predicate", text: "handles", tokenIndex: 2 },
      ],
      clauseBlocks: [`main|||${sentence}`],
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiResponse(first))
      .mockResolvedValueOnce(openAiResponse(second));
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeSentenceWithLlm({ text: sentence, settings: localSettings });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.translation).toBe(second.translation);
    expect(result.highlights).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "model", tokenIndex: 1, start: 4, end: 9 }),
      expect.objectContaining({ text: "handles", tokenIndex: 2 }),
    ]));

    const retryBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit)?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(retryBody.messages[1]?.content).toContain("quality_retry:");
    expect(retryBody.messages[1]?.content).toContain("1:model");
  });
});
