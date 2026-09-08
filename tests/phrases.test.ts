import { describe, expect, test } from "vitest";

import {
  findLearningPhraseAtOffset,
  findLearningPhraseMatches,
  normalizePhraseKey,
} from "../src/shared/phrases";

describe("learning phrases", () => {
  test("normalizes phrase keys", () => {
    expect(normalizePhraseKey("  Take   Into Account ")).toBe("take into account");
  });

  test("finds longest non-overlapping expressions", () => {
    const text = "We should take into account the context and account for the cost.";
    const matches = findLearningPhraseMatches(text);

    expect(matches.map((match) => match.surface)).toEqual([
      "take into account",
      "account for",
    ]);
  });

  test("resolves the phrase under the pointer", () => {
    const text = "The result may give rise to additional work.";
    const offset = text.indexOf("rise") + 1;

    expect(findLearningPhraseAtOffset(text, offset)).toEqual(
      expect.objectContaining({
        text: "give rise to",
        surface: "give rise to",
      }),
    );
  });

  test("does not match inside larger identifiers", () => {
    expect(findLearningPhraseMatches("account format is different")).toEqual([]);
  });
});
