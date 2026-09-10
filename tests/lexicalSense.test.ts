import { describe, expect, test, vi } from "vitest";

import {
  buildStructuredLexicalMetadata,
  describeEnglishWordForm,
  describeLearningIdentity,
  formatStructuredSensesForPrompt,
  lookupStructuredLexicalSenses,
} from "../src/shared/lexicalSense";

describe("structured lexical sense lookup", () => {
  test("labels regular word forms without replacing the surface", () => {
    expect(describeEnglishWordForm("collapses", "collapse", "verb")).toBe("3sg");
    expect(describeEnglishWordForm("blocks", "block", "noun")).toBe("plural");
    expect(describeEnglishWordForm("tracing", "trace", "verb")).toBe("present participle");
  });

  test("explains how morphology and compounds share or keep mastery", () => {
    expect(describeLearningIdentity("worked", "work", "verb")).toBe(
      "past / participle · mastery shared with work",
    );
    expect(describeLearningIdentity("saw", "see", "verb")).toBe(
      "inflected form · mastery kept separate from see",
    );
    expect(describeLearningIdentity("in-page", "in-page")).toBe(
      "components: in + page · mastery tracked as in-page",
    );
    expect(describeLearningIdentity("in-page", "in-page", undefined, "zh-CN")).toBe(
      "组成部分：in + page · 学习状态单独记录为 in-page",
    );
  });

  test("probes later lemma candidates when the first morphology candidate has no dictionary entry", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/collapses.jsonl") || url.endsWith("/collaps.jsonl")) {
        return { ok: url.endsWith("/collapses.jsonl"), text: async () => url.endsWith("/collapses.jsonl")
          ? JSON.stringify({ word: "collapses", pos: "verb", senses: [] })
          : "" };
      }
      if (url.endsWith("/collapse.jsonl")) {
        return { ok: true, text: async () => JSON.stringify({
          word: "collapse", pos: "verb", senses: [{ glosses: ["to fail completely"] }],
        }) };
      }
      return { ok: false, text: async () => "" };
    });

    const result = await lookupStructuredLexicalSenses("collapses", {
      contextText: "The mechanism collapses under the constraint.",
      learnerLanguageCode: "zh-CN",
      fetchFn: fetchMock as never,
    });
    expect(result.lemma).toBe("collapse");
    expect(result.wordFormLabel).toBe("3sg");
    expect(describeLearningIdentity(
      result.surface,
      result.lemma,
      "verb",
      result.learnerLanguageCode,
    )).toBe("3sg · 学习状态与 collapse 共享");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/collaps.jsonl"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/collapse.jsonl"))).toBe(true);
  });

  test("follows form-of metadata to the lemma and ranks contextual senses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/collapses.jsonl")) {
        return { ok: true, text: async () => JSON.stringify({
          word: "collapses", pos: "verb", senses: [{ tags: ["form-of"], form_of: [{ word: "collapse" }], glosses: ["third-person singular of collapse"] }],
        }) };
      }
      if (url.endsWith("/collapse.jsonl")) {
        return { ok: true, text: async () => [
          JSON.stringify({ word: "collapse", pos: "verb", senses: [
            { glosses: ["to fall down suddenly, as a building or structure"], translations: [{ lang_code: "cmn", word: "倒塌" }] },
            { glosses: ["to fail completely, as a system or organization"], translations: [{ lang_code: "cmn", word: "崩溃" }] },
          ] }),
        ].join("\n") };
      }
      return { ok: false, text: async () => "" };
    });

    const result = await lookupStructuredLexicalSenses("collapses", {
      contextText: "The building collapses during the quake.",
      partOfSpeech: "verb",
      learnerLanguageCode: "zh-CN",
      fetchFn: fetchMock as never,
    });
    expect(result.lemma).toBe("collapse");
    expect(result.wordFormLabel).toBe("3sg");
    expect(result.senses).toHaveLength(2);
    expect(result.senses[0]?.targetMeanings).toContain("倒塌");
    expect(formatStructuredSensesForPrompt(result)).toContain("learner_translations=倒塌");
  });
});

test("builds visible metadata for the fast translation path", () => {
  const metadata = buildStructuredLexicalMetadata({
    surface: "predictions",
    lemma: "prediction",
    wordFormLabel: "plural",
    learnerLanguageCode: "zh-CN",
    senses: [
      { partOfSpeech: "noun", gloss: "A statement about what will happen in the future.", targetMeanings: ["预测", "预言"], source: "kaikki" },
      { partOfSpeech: "noun", gloss: "A forecast produced by a model.", targetMeanings: ["预测结果"], source: "kaikki" },
    ],
  }, "预测");
  expect(metadata.lexicalLemma).toBe("prediction");
  expect(metadata.wordFormLabel).toBe("plural · 学习状态与 prediction 共享");
  expect(metadata.semanticHint).toContain("statement");
  expect(metadata.alternativeMeanings?.map((item) => item.meaning)).toEqual(["预言", "预测结果"]);
});
