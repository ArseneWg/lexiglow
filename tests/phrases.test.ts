import { describe, expect, test } from "vitest";

import {
  findLearningPhraseAtOffset,
  findLearningPhraseMatches,
  normalizePhraseKey,
} from "../src/shared/phrases";

describe("learning phrases", () => {
  test("normalizes base and inflected phrase keys to one learning identity", () => {
    expect(normalizePhraseKey("  Take   Into Account ")).toBe("take into account");
    expect(normalizePhraseKey("took into account")).toBe("take into account");
    expect(normalizePhraseKey("accounts for")).toBe("account for");
    expect(normalizePhraseKey("carried out")).toBe("carry out");
    expect(normalizePhraseKey("is subject to")).toBe("be subject to");
  });

  test("finds longest non-overlapping expressions", () => {
    const text = "We should take into account the context and account for the cost.";
    const matches = findLearningPhraseMatches(text);

    expect(matches.map((match) => match.surface)).toEqual([
      "take into account",
      "account for",
    ]);
  });

  test("finds inflected phrasal verbs while returning the canonical phrase", () => {
    const text = "The team carried out the test and accounted for the missing data.";
    const matches = findLearningPhraseMatches(text);

    expect(matches).toEqual([
      expect.objectContaining({ text: "carry out", surface: "carried out" }),
      expect.objectContaining({ text: "account for", surface: "accounted for" }),
    ]);
  });

  test("resolves an inflected phrase under the pointer", () => {
    const text = "The result gave rise to additional work.";
    const offset = text.indexOf("rise") + 1;

    expect(findLearningPhraseAtOffset(text, offset)).toEqual(
      expect.objectContaining({
        text: "give rise to",
        surface: "gave rise to",
      }),
    );
  });

  test("does not match inside larger identifiers", () => {
    expect(findLearningPhraseMatches("account format is different")).toEqual([]);
  });
});
