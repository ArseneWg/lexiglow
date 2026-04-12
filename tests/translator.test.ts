import { describe, expect, test } from "vitest";

import {
  parseEnglishExplanationResponse,
  parseGoogleTranslateResponse,
  parseLlmTranslationResponse,
  parseSentenceAnalysisResponse,
  sanitizeTranslatorSettings,
} from "../src/shared/translator";

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
      parseLlmTranslationResponse('{"word":"收到的","sentence":"我们昨天收到了你的包裹。"}'),
    ).toEqual({
      translation: "收到的",
      sentenceTranslation: "我们昨天收到了你的包裹。",
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
        '{"word":"这里表示收到、接到。","english":"If you receive something, you get it from someone."}',
      ),
    ).toEqual({
      translation: "这里表示收到、接到。",
      englishExplanation: "If you receive something, you get it from someone.",
    });
  });
});

describe("sentence analysis parsing", () => {
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
});
