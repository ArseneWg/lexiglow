import { describe, expect, test } from "vitest";

import {
  countEnglishWords,
  extractWordAtOffset,
  getHyphenatedCompoundComponents,
  isEnglishSelectionText,
  isSingleEnglishWord,
  normalizeSingleEnglishWord,
  validateEnglishSelectionText,
} from "../src/shared/word";

describe("extractWordAtOffset", () => {
  test("extracts a word under the cursor", () => {
    expect(extractWordAtOffset("Hover on running words", 10)).toEqual({
      surface: "running",
      start: 9,
      end: 16,
    });
  });

  test("extracts contractions with typographic apostrophes", () => {
    expect(extractWordAtOffset("I don’t know", 4)).toEqual({
      surface: "don’t",
      start: 2,
      end: 7,
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

  test("treats hyphenated compounds as one lexical unit", () => {
    expect(extractWordAtOffset("Use mixed-precision training.", 8)).toEqual({
      surface: "mixed-precision",
      start: 4,
      end: 19,
    });
    expect(extractWordAtOffset("Use mixed-precision training.", 14)).toEqual({
      surface: "mixed-precision",
      start: 4,
      end: 19,
    });
    expect(extractWordAtOffset("The result is high-impact work.", 21)).toEqual({
      surface: "high-impact",
      start: 14,
      end: 25,
    });
  });
});

describe("selection helpers", () => {
  test("detects lexical words and compounds", () => {
    expect(isSingleEnglishWord("received")).toBe(true);
    expect(isSingleEnglishWord("received.")).toBe(true);
    expect(isSingleEnglishWord("don’t")).toBe(true);
    expect(isSingleEnglishWord("mixed-precision")).toBe(true);
    expect(isSingleEnglishWord("look up")).toBe(false);
  });

  test("normalizes selected lexical units by trimming edge punctuation", () => {
    expect(normalizeSingleEnglishWord("\"received.\"")).toBe("received");
    expect(normalizeSingleEnglishWord("(continue)")).toBe("continue");
    expect(normalizeSingleEnglishWord("worked,")).toBe("worked");
    expect(normalizeSingleEnglishWord("don’t")).toBe("don't");
    expect(normalizeSingleEnglishWord("high-impact")).toBe("high-impact");
  });

  test("exposes hyphenated components without changing the compound token", () => {
    expect(getHyphenatedCompoundComponents("in-page")).toEqual(["in", "page"]);
    expect(getHyphenatedCompoundComponents("state-of-the-art")).toEqual(["state", "of", "the", "art"]);
    expect(getHyphenatedCompoundComponents("don’t-stop")).toEqual(["don't", "stop"]);
    expect(getHyphenatedCompoundComponents("ordinary")).toEqual([]);
  });

  test("accepts english words, phrases, and sentences", () => {
    expect(isEnglishSelectionText("received")).toBe(true);
    expect(isEnglishSelectionText("don’t stop reading")).toBe(true);
    expect(isEnglishSelectionText("look up")).toBe(true);
    expect(isEnglishSelectionText("mixed-precision")).toBe(true);
    expect(isEnglishSelectionText("He received the package yesterday.")).toBe(true);
    expect(isEnglishSelectionText("Revenue grew by 12.5% in Q4/FY2025.")).toBe(true);
    expect(isEnglishSelectionText("Ping @alice and confirm the deploy still works.")).toBe(true);
    expect(isEnglishSelectionText("Review #release-notes and summarize the key changes.")).toBe(true);
    expect(
      isEnglishSelectionText(
        "Open the settings page and confirm you can switch learner language plus OpenAI / Compatible, Gemini, and Claude",
      ),
    ).toBe(true);
    expect(isEnglishSelectionText(`${"This is a longer English paragraph. ".repeat(20).trim()}`)).toBe(true);
  });

  test("rejects mentions and non-english selections", () => {
    expect(isEnglishSelectionText("@somebody")).toBe(false);
    expect(isEnglishSelectionText("@somebody @another")).toBe(false);
    expect(isEnglishSelectionText("#release")).toBe(false);
    expect(isEnglishSelectionText("这是中文")).toBe(false);
  });

  test("rejects technical identifiers and file-like tokens", () => {
    expect(isEnglishSelectionText("reg16")).toBe(false);
    expect(isEnglishSelectionText(".yaml")).toBe(false);
    expect(isEnglishSelectionText("dev_err")).toBe(false);
    expect(isEnglishSelectionText("linux-rockchip@")).toBe(false);
    expect(isEnglishSelectionText("https://example.com/docs")).toBe(false);
  });

  test("returns a distinct validation reason for overlong selections", () => {
    expect(validateEnglishSelectionText("English ".repeat(200))).toBe("tooLong");
    expect(validateEnglishSelectionText("这是中文")).toBe("containsCjk");
    expect(validateEnglishSelectionText("@somebody")).toBe("technical");
  });

  test("counts hyphenated lexical compounds as one unit", () => {
    expect(countEnglishWords("in   charge   of")).toBe(3);
    expect(countEnglishWords("mixed-precision")).toBe(1);
    expect(countEnglishWords("don’t stop")).toBe(2);
  });
});
