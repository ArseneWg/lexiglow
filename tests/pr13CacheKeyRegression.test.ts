import { describe, expect, test } from "vitest";

import {
  buildLexicalMetadataCacheKey,
  buildStructuredLexicalMetadata,
} from "../src/shared/lexicalSense";

describe("PR13 lexical metadata cache key", () => {
  test("separates results by primary translation", () => {
    const common = {
      learnerLanguageCode: "zh-CN",
      surface: "predictions",
      partOfSpeech: "noun",
      contextText: "The predictions match the benchmark.",
    };
    expect(buildLexicalMetadataCacheKey({ ...common, primaryTranslation: "预测" }))
      .not.toBe(buildLexicalMetadataCacheKey({ ...common, primaryTranslation: "预言" }));
  });

  test("normalizes whitespace and bounds context length", () => {
    const common = {
      learnerLanguageCode: "zh-CN",
      surface: "predictions",
      primaryTranslation: "预测",
    };
    expect(buildLexicalMetadataCacheKey({ ...common, contextText: "  The   model   predicts.  " }))
      .toBe(buildLexicalMetadataCacheKey({ ...common, contextText: "The model predicts." }));
    const prefix = "x".repeat(600);
    expect(buildLexicalMetadataCacheKey({ ...common, contextText: prefix + "tail-a" }))
      .toBe(buildLexicalMetadataCacheKey({ ...common, contextText: prefix + "tail-b" }));
  });

  test("alternative meaning de-duplication remains case-insensitive", () => {
    const result = buildStructuredLexicalMetadata({
      surface: "ITEM",
      lemma: "item",
      senses: [{
        partOfSpeech: "noun",
        gloss: "A thing.",
        targetMeanings: ["ITEM", "item two"],
        source: "kaikki",
      }],
    }, "item");
    expect(result.alternativeMeanings?.map((item) => item.meaning)).toEqual(["item two"]);
  });
});
