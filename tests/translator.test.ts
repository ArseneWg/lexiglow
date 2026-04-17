import { afterEach, describe, expect, test, vi } from "vitest";

import {
  analyzeSentenceWithLlm,
  getLlmCacheSignature,
  getTranslatorCacheTtlMs,
  parseEnglishExplanationResponse,
  parseGoogleTranslateResponse,
  parseLlmTranslationResponse,
  parseSentenceAnalysisResponse,
  sanitizeTranslatorSettings,
  summarizeDictionaryPartOfSpeech,
  translateSelectionWithLlm,
} from "../src/shared/translator";
import { getDisplayClauseBlocks } from "../src/shared/sentenceAnalysisDisplay";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("google response parsing", () => {
  test("joins translation segments", () => {
    const payload = [[["你好", "hello", null, null, 10]], null, "en"];
    expect(parseGoogleTranslateResponse(payload)).toBe("你好");
  });

  test("returns empty string for unexpected payloads", () => {
    expect(parseGoogleTranslateResponse({})).toBe("");
  });
});

describe("llm response parsing", () => {
  test("reads structured word and sentence translations", () => {
    expect(
      parseLlmTranslationResponse('{"word":"收到的","sentence":"我们昨天收到了你的包裹。","pos":"verb"}'),
    ).toEqual({
      translation: "收到的",
      sentenceTranslation: "我们昨天收到了你的包裹。",
      contextualPartOfSpeech: "v.",
    });
  });

  test("falls back to plain text when response is not json", () => {
    expect(parseLlmTranslationResponse("收到的")).toEqual({
      translation: "收到的",
    });
  });

  test("defaults llm display mode to word", () => {
    expect(sanitizeTranslatorSettings({}).llmDisplayMode).toBe("word");
  });

  test("accepts english as llm display mode", () => {
    expect(sanitizeTranslatorSettings({ llmDisplayMode: "english" }).llmDisplayMode).toBe("english");
  });

  test("defaults llm provider to openai-compatible mode", () => {
    expect(sanitizeTranslatorSettings({}).llmProvider).toBe("openai");
  });

  test("defaults cache duration settings", () => {
    expect(sanitizeTranslatorSettings({})).toEqual(expect.objectContaining({
      learnerLanguageCode: "zh-CN",
      cacheDurationValue: 30,
      cacheDurationUnit: "minutes",
    }));
  });

  test("accepts supported learner languages and falls back for unknown ones", () => {
    expect(sanitizeTranslatorSettings({ learnerLanguageCode: "ja" }).learnerLanguageCode).toBe("ja");
    expect(sanitizeTranslatorSettings({ learnerLanguageCode: "xx" as never }).learnerLanguageCode).toBe("zh-CN");
  });

  test("computes cache ttl from value and unit", () => {
    expect(getTranslatorCacheTtlMs(sanitizeTranslatorSettings({
      cacheDurationValue: 45,
      cacheDurationUnit: "minutes",
    }))).toBe(45 * 60 * 1000);

    expect(getTranslatorCacheTtlMs(sanitizeTranslatorSettings({
      cacheDurationValue: 2,
      cacheDurationUnit: "hours",
    }))).toBe(2 * 60 * 60 * 1000);
  });

  test("uses provider-specific default base url and model", () => {
    expect(sanitizeTranslatorSettings({ llmProvider: "gemini" })).toEqual(expect.objectContaining({
      llmProvider: "gemini",
      providerBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      providerModel: "gemini-2.5-flash",
    }));

    expect(sanitizeTranslatorSettings({ llmProvider: "claude" })).toEqual(expect.objectContaining({
      llmProvider: "claude",
      providerBaseUrl: "https://api.anthropic.com/v1",
      providerModel: "claude-sonnet-4-20250514",
    }));
  });

  test("separates llm cache signatures by provider and model", () => {
    expect(getLlmCacheSignature(sanitizeTranslatorSettings({
      llmProvider: "openai",
      providerBaseUrl: "https://api.openai.com/v1/",
      providerModel: "gpt-4.1-mini",
      learnerLanguageCode: "zh-CN",
    }))).toBe("openai::https://api.openai.com/v1::gpt-4.1-mini::zh-CN");

    expect(getLlmCacheSignature(sanitizeTranslatorSettings({
      llmProvider: "gemini",
      providerBaseUrl: "https://api.openai.com/v1/",
      providerModel: "gpt-4.1-mini",
      learnerLanguageCode: "ja",
    }))).toBe("gemini::https://api.openai.com/v1::gpt-4.1-mini::ja");
  });

  test("reads structured english explanation payload", () => {
    expect(
      parseEnglishExplanationResponse(
        '{"meaning":"这里表示收到、接到。","explanation":"If you receive something, you get it from someone."}',
      ),
    ).toEqual({
      meaning: "这里表示收到、接到。",
      explanation: "If you receive something, you get it from someone.",
    });
  });

  test("reads english explanation from unified llm payload", () => {
    expect(
      parseLlmTranslationResponse(
        '{"word":"这里表示收到、接到。","english":"If you receive something, you get it from someone.","pos":"verb"}',
      ),
    ).toEqual({
      translation: "这里表示收到、接到。",
      englishExplanation: "If you receive something, you get it from someone.",
      contextualPartOfSpeech: "v.",
    });
  });

  test("normalizes contextual verb variants from llm output", () => {
    expect(
      parseLlmTranslationResponse('{"word":"合并","sentence":"合并前进行多代理代码审查。","pos":"gerund"}'),
    ).toEqual({
      translation: "合并",
      sentenceTranslation: "合并前进行多代理代码审查。",
      contextualPartOfSpeech: "v.",
    });

    expect(
      parseLlmTranslationResponse('{"word":"合并","sentence":"合并前进行多代理代码审查。","pos":"verb (gerund)"}'),
    ).toEqual({
      translation: "合并",
      sentenceTranslation: "合并前进行多代理代码审查。",
      contextualPartOfSpeech: "v.",
    });
  });

  test("summarizes dictionary part-of-speech labels", () => {
    expect(
      summarizeDictionaryPartOfSpeech([
        {
          meanings: [
            { partOfSpeech: "noun" },
            { partOfSpeech: "verb" },
            { partOfSpeech: "noun" },
          ],
        },
      ]),
    ).toBe("n. / v.");
  });

  test("ignores unknown dictionary part-of-speech labels", () => {
    expect(
      summarizeDictionaryPartOfSpeech([
        {
          meanings: [
            { partOfSpeech: "prefix" },
          ],
        },
      ]),
    ).toBeUndefined();
  });
});

describe("llm provider requests", () => {
  test("formats openai-compatible selection translation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"word":"保留"}',
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateSelectionWithLlm({
      text: "preserves",
      contextText: "Codex sync preserves non-managed config.toml content.",
      settings: sanitizeTranslatorSettings({
        llmProvider: "openai",
        providerBaseUrl: "https://api.openai.com/v1",
        providerModel: "gpt-4.1-mini",
        apiKey: "openai-key",
        learnerLanguageCode: "ja",
      }),
    });

    expect(result.translation).toBe("保留");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>;
      model: string;
      response_format?: unknown;
    };

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((request.headers as Record<string, string>).Authorization).toBe("Bearer openai-key");
    expect(payload.model).toBe("gpt-4.1-mini");
    expect(payload.messages[0]?.content).toContain("Japanese (ja)");
    expect(payload.messages[0]?.content).toContain(
      "Keep person names, usernames, brand names, and product names in their original English form",
    );
    expect(payload.messages.at(-1)?.content).toContain("selected_text: preserves");
    expect(payload.response_format).toBeUndefined();
  });

  test("formats gemini selection translation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: '{"word":"保留"}' }],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateSelectionWithLlm({
      text: "preserves",
      contextText: "Codex sync preserves non-managed config.toml content.",
      settings: sanitizeTranslatorSettings({
        llmProvider: "gemini",
        providerBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        providerModel: "gemini-2.5-flash",
        apiKey: "gemini-key",
        learnerLanguageCode: "fr",
      }),
    });

    expect(result.translation).toBe("保留");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as {
      system_instruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      generationConfig: { responseMimeType?: string };
    };

    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect((request.headers as Record<string, string>)["x-goog-api-key"]).toBe("gemini-key");
    expect(payload.system_instruction.parts[0]?.text).toContain("French (fr)");
    expect(payload.system_instruction.parts[0]?.text).toContain(
      "Keep person names, usernames, brand names, and product names in their original English form",
    );
    expect(payload.contents[0]?.role).toBe("user");
    expect(payload.contents[0]?.parts[0]?.text).toContain("selected_text: preserves");
    expect(payload.generationConfig.responseMimeType).toBe("application/json");
  });

  test("formats claude selection translation requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"word":"保留"}' }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateSelectionWithLlm({
      text: "preserves",
      contextText: "Codex sync preserves non-managed config.toml content.",
      settings: sanitizeTranslatorSettings({
        llmProvider: "claude",
        providerBaseUrl: "https://api.anthropic.com/v1",
        providerModel: "claude-sonnet-4-20250514",
        apiKey: "claude-key",
        learnerLanguageCode: "de",
      }),
    });

    expect(result.translation).toBe("保留");
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as {
      model: string;
      system: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((request.headers as Record<string, string>)["x-api-key"]).toBe("claude-key");
    expect((request.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(payload.model).toBe("claude-sonnet-4-20250514");
    expect(payload.system).toContain("German (de)");
    expect(payload.system).toContain(
      "Keep person names, usernames, brand names, and product names in their original English form",
    );
    expect(payload.messages[0]?.content).toContain("selected_text: preserves");
    expect(payload.max_tokens).toBe(180);
  });
});

describe("sentence analysis parsing", () => {
  test("sends the full analysis sentence without trimContext truncation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                translation: "完整译文。",
                structure: "main clause",
                analysisSteps: ["一", "二", "三", "四"],
                highlights: ["predicate|||works"],
                clauseBlocks: ["main|||A very long sentence"],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const longSentence = ` ${"A".repeat(230)} ${"B".repeat(90)} `;

    await analyzeSentenceWithLlm({
      text: longSentence,
      settings: {
        llmProvider: "openai",
        providerBaseUrl: "https://example.com/v1",
        providerModel: "test-model",
        apiKey: "test-key",
        fallbackToGoogle: true,
        learnerLanguageCode: "ko",
        llmDisplayMode: "word",
        cacheDurationValue: 30,
        cacheDurationUnit: "minutes",
      },
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(payload.messages[0]?.content).toContain("Korean (ko)");
    expect(payload.messages[0]?.content).toContain(
      "Keep person names, usernames, brand names, and product names in their original English form",
    );
    expect(payload.messages.at(-1)?.content).toBe(`sentence: ${longSentence.trim()}`);
  });

  test("reads structured analysis payload", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"尽管实验失败了，团队仍然决定继续。","structure":"主句是 team decided，although 引导让步状语从句。","analysisSteps":["先抓主句主干，主语是 team，谓语是 decided。","再看 although 引导的让步状语从句，交代背景。","最后补足 to continue 这个不定式，说明决定的内容。","顺着中文表达把整句译通。"],"highlights":[{"text":"Although","category":"conjunction"},{"text":"team","category":"subject"},{"text":"decided","category":"predicate"},{"text":"continue","category":"nonfinite"}],"clauseBlocks":[{"text":"Although the experiment failed,","type":"subordinate","label":"句块1"},{"text":"the team still decided","type":"main","label":"句块2"},{"text":"to continue","type":"nonfinite","label":"句块3"}]}',
      ),
    ).toEqual({
      translation: "尽管实验失败了，团队仍然决定继续。",
      structure: "主句是 team decided，although 引导让步状语从句。",
      analysisSteps: [
        "先抓主句主干，主语是 team，谓语是 decided。",
        "再看 although 引导的让步状语从句，交代背景。",
        "最后补足 to continue 这个不定式，说明决定的内容。",
        "顺着中文表达把整句译通。",
      ],
      highlights: [
        { text: "Although", category: "conjunction" },
        { text: "team", category: "subject" },
        { text: "decided", category: "predicate" },
        { text: "continue", category: "nonfinite" },
      ],
      clauseBlocks: [
        { text: "Although the experiment failed,", type: "subordinate", label: "句块1" },
        { text: "the team still decided", type: "main", label: "句块2" },
        { text: "to continue", type: "nonfinite", label: "句块3" },
      ],
    });
  });

  test("reads structured analysis payload from fixed summary fields", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"这为我们提供了同样的混合精度优势。","structure":"主干是 This gives us the benefit。","cutSummary":"先根据 but 和 over 这类结构信号切出主句与补充说明。","backboneSummary":"主句主干是 This gives us the same mixed-precision benefit。","branchSummary":"as autocast 修饰 benefit；but 引出补充部分；over what runs in which precision 说明 control 的具体内容。","translationSummary":"顺着中文表达先译主干，再补足比较和控制范围。","highlights":[{"text":"gives","category":"predicate"},{"text":"but","category":"conjunction"},{"text":"over","category":"preposition"}],"clauseBlocks":[{"text":"This gives us the same mixed-precision benefit","type":"main"},{"text":"as autocast","type":"modifier"},{"text":"but with full explicit control over what runs in which precision.","type":"parallel"}]}',
      ),
    ).toEqual({
      translation: "这为我们提供了同样的混合精度优势。",
      structure: "主干是 This gives us the benefit。",
      analysisSteps: [
        "先根据 but 和 over 这类结构信号切出主句与补充说明。",
        "主句主干是 This gives us the same mixed-precision benefit。",
        "as autocast 修饰 benefit；but 引出补充部分；over what runs in which precision 说明 control 的具体内容。",
        "顺着中文表达先译主干，再补足比较和控制范围。",
      ],
      highlights: [
        { text: "gives", category: "predicate" },
        { text: "but", category: "conjunction" },
        { text: "over", category: "preposition" },
      ],
      clauseBlocks: [
        { text: "This gives us the same mixed-precision benefit", type: "main", label: undefined },
        { text: "as autocast", type: "modifier", label: undefined },
        {
          text: "but with full explicit control over what runs in which precision.",
          type: "parallel",
          label: undefined,
        },
      ],
    });
  });

  test("reads structured analysis payload from stable string arrays", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"这为我们提供了同样的混合精度优势。","structure":"主干是 This gives us the benefit。","cutSummary":"先根据 but 和 over 这类结构信号切出主句与补充说明。","backboneSummary":"主句主干是 This gives us the same mixed-precision benefit。","branchSummary":"as autocast 修饰 benefit；but 引出补充部分；over what runs in which precision 说明 control 的具体内容。","translationSummary":"顺着中文表达先译主干，再补足比较和控制范围。","highlights":["predicate|||gives","conjunction|||but","preposition|||over"],"clauseBlocks":["main|||This gives us the same mixed-precision benefit","modifier|||as autocast","parallel|||but with full explicit control over what runs in which precision."]}',
      ),
    ).toEqual({
      translation: "这为我们提供了同样的混合精度优势。",
      structure: "主干是 This gives us the benefit。",
      analysisSteps: [
        "先根据 but 和 over 这类结构信号切出主句与补充说明。",
        "主句主干是 This gives us the same mixed-precision benefit。",
        "as autocast 修饰 benefit；but 引出补充部分；over what runs in which precision 说明 control 的具体内容。",
        "顺着中文表达先译主干，再补足比较和控制范围。",
      ],
      highlights: [
        { text: "gives", category: "predicate" },
        { text: "but", category: "conjunction" },
        { text: "over", category: "preposition" },
      ],
      clauseBlocks: [
        { text: "This gives us the same mixed-precision benefit", type: "main", label: undefined },
        { text: "as autocast", type: "modifier", label: undefined },
        {
          text: "but with full explicit control over what runs in which precision.",
          type: "parallel",
          label: undefined,
        },
      ],
    });
  });

  test("drops plain prepositions from analysis highlights", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"团队决定继续。","structure":"主干是 team decided。","analysisSteps":["先找主干。","再看不定式。","补足修饰。","最后顺译。"],"highlights":[{"text":"to","category":"nonfinite"},{"text":"decided","category":"predicate"},{"text":"continue","category":"nonfinite"}],"clauseBlocks":[{"text":"the team decided","type":"main"},{"text":"to continue","type":"nonfinite"}]}',
      ),
    ).toEqual({
      translation: "团队决定继续。",
      structure: "主干是 team decided。",
      analysisSteps: ["先找主干。", "再看不定式。", "补足修饰。", "最后顺译。"],
      highlights: [
        { text: "decided", category: "predicate" },
        { text: "continue", category: "nonfinite" },
      ],
      clauseBlocks: [
        { text: "the team decided", type: "main", label: undefined },
        { text: "to continue", type: "nonfinite", label: undefined },
      ],
    });
  });

  test("accepts model-selected preposition highlights", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"该方法在实践中被使用。","structure":"主干是 method is used。","analysisSteps":["先找主干。","再看后置修饰。","补足介词链。","最后顺译。"],"highlights":[{"text":"used","category":"nonfinite"},{"text":"in","category":"preposition"},{"text":"practice","category":"subject"}],"clauseBlocks":[{"text":"a method","type":"main"},{"text":"used in practice","type":"nonfinite"}]}',
      ),
    ).toEqual({
      translation: "该方法在实践中被使用。",
      structure: "主干是 method is used。",
      analysisSteps: ["先找主干。", "再看后置修饰。", "补足介词链。", "最后顺译。"],
      highlights: [
        { text: "used", category: "nonfinite" },
        { text: "in", category: "preposition" },
        { text: "practice", category: "subject" },
      ],
      clauseBlocks: [
        { text: "a method", type: "main", label: undefined },
        { text: "used in practice", type: "nonfinite", label: undefined },
      ],
    });
  });

  test("preserves model-selected conjunction highlights without parser-side reclassification", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"目前，开发重点是调优预训练阶段。","structure":"the focus is tuning.","analysisSteps":["先看句首状语。","再抓主干。","再看后置修饰。","再看非谓语。","最后顺译。"],"highlights":[{"text":"Presently","category":"conjunction"},{"text":"is","category":"predicate"},{"text":"tuning","category":"nonfinite"},{"text":"which","category":"relative"}],"clauseBlocks":[{"text":"Presently, the main focus of development is on tuning the pretraining stage,","type":"main"},{"text":"which takes the most amount of compute.","type":"relative"}]}',
      ),
    ).toEqual({
      translation: "目前，开发重点是调优预训练阶段。",
      structure: "the focus is tuning.",
      analysisSteps: ["先看句首状语。", "再抓主干。", "再看后置修饰。", "再看非谓语。", "最后顺译。"],
      highlights: [
        { text: "Presently", category: "conjunction" },
        { text: "is", category: "predicate" },
        { text: "tuning", category: "nonfinite" },
        { text: "which", category: "relative" },
      ],
      clauseBlocks: [
        {
          text: "Presently, the main focus of development is on tuning the pretraining stage,",
          type: "main",
          label: undefined,
        },
        { text: "which takes the most amount of compute.", type: "relative", label: undefined },
      ],
    });
  });

  test("repairs common missing-comma issues in sentence analysis json", () => {
    expect(
      parseSentenceAnalysisResponse(
        '{"translation":"请在提交 PR 时披露重要的 LLM 参与部分。","structure":"主干是 please declare。","analysisSteps":["先找主句主干。""再看 when 引导的时间状语。","再看 that 引导的宾语内容。","最后顺译。"],"highlights":[{"text":"When","category":"conjunction"}{"text":"declare","category":"predicate"},{"text":"that","category":"relative"}],"clauseBlocks":[{"text":"When submitting a PR,","type":"subordinate"},{"text":"please declare any parts","type":"main"},{"text":"that had substantial LLM contribution","type":"relative"}]}',
      ),
    ).toEqual({
      translation: "请在提交 PR 时披露重要的 LLM 参与部分。",
      structure: "主干是 please declare。",
      analysisSteps: ["先找主句主干。", "再看 when 引导的时间状语。", "再看 that 引导的宾语内容。", "最后顺译。"],
      highlights: [
        { text: "When", category: "conjunction" },
        { text: "declare", category: "predicate" },
        { text: "that", category: "relative" },
      ],
      clauseBlocks: [
        { text: "When submitting a PR,", type: "subordinate", label: undefined },
        { text: "please declare any parts", type: "main", label: undefined },
        { text: "that had substantial LLM contribution", type: "relative", label: undefined },
      ],
    });
  });

  test("keeps commas attached to the preceding clause in display blocks for real analysis text", () => {
    const sentence =
      "It is designed to run on a single GPU node, the code is minimal/hackable, and it covers all major LLM stages including tokenization, pretraining, finetuning, evaluation, inference, and a chat UI.";
    const parsed = parseSentenceAnalysisResponse(
      '{"translation":"它被设计为在单个 GPU 节点上运行，代码保持最小化且便于修改，并覆盖了包括分词、预训练、微调、评估、推理和聊天界面在内的主要 LLM 阶段。","structure":"It is designed, the code is minimal, and it covers stages.","analysisSteps":["先按逗号和 and 切出三个并列层次。","主干是 It is designed / the code is / it covers 三个并列判断。","including 引出的部分补充说明 covers 的具体范围。","run 是 is designed 的补足成分，说明设计用途。","中文先顺着三个并列分句译出，再补上 including 的列举内容。"],"highlights":["predicate|||designed","predicate|||is","conjunction|||and","predicate|||covers","nonfinite|||including"],"clauseBlocks":["main|||It is designed to run on a single GPU node","main|||the code is minimal/hackable","parallel|||and it covers all major LLM stages including tokenization, pretraining, finetuning, evaluation, inference, and a chat UI."]}',
    );

    expect(getDisplayClauseBlocks(sentence, parsed.clauseBlocks).map((block) => block.text)).toEqual([
      "It is designed to run on a single GPU node,",
      "the code is minimal/hackable,",
      "and it covers all major LLM stages including tokenization, pretraining, finetuning, evaluation, inference, and a chat UI.",
    ]);
  });
});
