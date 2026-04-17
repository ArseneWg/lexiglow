import { describe, expect, test } from "vitest";

import {
  countEnglishWords,
  extractWordAtOffset,
  isAuthorBylineWord,
  isEnglishSelectionText,
  isSingleEnglishWord,
  normalizeSingleEnglishWord,
} from "../src/shared/word";

describe("extractWordAtOffset", () => {
  test("extracts a word under the cursor", () => {
    expect(extractWordAtOffset("Hover on running words", 10)).toEqual({
      surface: "running",
      start: 9,
      end: 16,
    });
  });

  test("skips non-english tokens", () => {
    expect(extractWordAtOffset("abc123", 2)).toBeNull();
  });

  test("skips @mention handles", () => {
    expect(extractWordAtOffset("@somebody replied", 4)).toBeNull();
  });

  test("skips technical tokens with punctuation or underscores", () => {
    expect(extractWordAtOffset(".yaml file", 2)).toBeNull();
    expect(extractWordAtOffset("dev_err happened", 2)).toBeNull();
    expect(extractWordAtOffset("linux-rockchip@ host", 2)).toBeNull();
    expect(extractWordAtOffset("example.com/docs", 2)).toBeNull();
  });

  test("keeps sentence-ending words valid when followed by punctuation", () => {
    expect(extractWordAtOffset("He worked.", 7)).toEqual({
      surface: "worked",
      start: 3,
      end: 9,
    });
  });

  test("extracts words next to clause punctuation like colons and commas", () => {
    expect(extractWordAtOffset("Each cycle compounds: brainstorms sharpen plans", 12)).toEqual({
      surface: "compounds",
      start: 11,
      end: 20,
    });
    expect(extractWordAtOffset("plans inform future plans, reviews catch more issues", 8)).toEqual({
      surface: "inform",
      start: 6,
      end: 12,
    });
  });

  test("extracts sentence-final words before a period", () => {
    expect(extractWordAtOffset("patterns get documented.", 18)).toEqual({
      surface: "documented",
      start: 13,
      end: 23,
    });
  });

  test("extracts each side of a hyphenated compound as its own word", () => {
    expect(extractWordAtOffset("Use mixed-precision training.", 8)).toEqual({
      surface: "mixed",
      start: 4,
      end: 9,
    });
    expect(extractWordAtOffset("Use mixed-precision training.", 14)).toEqual({
      surface: "precision",
      start: 10,
      end: 19,
    });
  });

  test("extracts each side of another hyphenated compound independently", () => {
    expect(extractWordAtOffset("The result is high-impact work.", 16)).toEqual({
      surface: "high",
      start: 14,
      end: 18,
    });
    expect(extractWordAtOffset("The result is high-impact work.", 21)).toEqual({
      surface: "impact",
      start: 19,
      end: 25,
    });
  });
});

describe("selection helpers", () => {
  test("detects a single english word", () => {
    expect(isSingleEnglishWord("received")).toBe(true);
    expect(isSingleEnglishWord("received.")).toBe(true);
    expect(isSingleEnglishWord("mixed-precision")).toBe(false);
    expect(isSingleEnglishWord("look up")).toBe(false);
  });

  test("normalizes single selected words by trimming edge punctuation", () => {
    expect(normalizeSingleEnglishWord("\"received.\"")).toBe("received");
    expect(normalizeSingleEnglishWord("(continue)")).toBe("continue");
    expect(normalizeSingleEnglishWord("worked,")).toBe("worked");
    expect(normalizeSingleEnglishWord("high-impact")).toBe("");
  });

  test("accepts english words, phrases, and sentences", () => {
    expect(isEnglishSelectionText("received")).toBe(true);
    expect(isEnglishSelectionText("look up")).toBe(true);
    expect(isEnglishSelectionText("He received the package yesterday.")).toBe(true);
    expect(isEnglishSelectionText("Revenue grew by 12.5% in Q4/FY2025.")).toBe(true);
  });

  test("rejects mentions and non-english selections", () => {
    expect(isEnglishSelectionText("@somebody replied")).toBe(false);
    expect(isEnglishSelectionText("这是中文")).toBe(false);
  });

  test("rejects technical identifiers and file-like tokens", () => {
    expect(isEnglishSelectionText("reg16")).toBe(false);
    expect(isEnglishSelectionText(".yaml")).toBe(false);
    expect(isEnglishSelectionText("dev_err")).toBe(false);
    expect(isEnglishSelectionText("linux-rockchip@")).toBe(false);
    expect(isEnglishSelectionText("https://example.com/docs")).toBe(false);
  });

  test("counts english words in normalized selections", () => {
    expect(countEnglishWords("in   charge   of")).toBe(3);
    expect(countEnglishWords("mixed-precision")).toBe(2);
  });

  test("detects hacker-news style author bylines", () => {
    const line = "149 points by scaredpelican 8 hours ago | hide | 32 comments";
    const start = line.indexOf("scaredpelican");
    expect(isAuthorBylineWord(line, "scaredpelican", start, start + "scaredpelican".length)).toBe(true);
    expect(isAuthorBylineWord(line, "149", 0, 3)).toBe(false);
    expect(isAuthorBylineWord("By the way, we should ship it.", "way", 3, 6)).toBe(false);
  });
});
