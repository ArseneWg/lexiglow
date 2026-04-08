import { describe, expect, test } from "vitest";

import {
  countEnglishWords,
  extractWordAtOffset,
  isEnglishSelectionText,
  isSingleEnglishWord,
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
});

describe("selection helpers", () => {
  test("detects a single english word", () => {
    expect(isSingleEnglishWord("received")).toBe(true);
    expect(isSingleEnglishWord("look up")).toBe(false);
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
  });
});
