import { describe, expect, test } from "vitest";

import { lookupRank } from "../src/shared/lexicon";
import {
  DEFAULT_SETTINGS,
  countTotalKnown,
  estimateLearnerLevel,
  looksLikeSpecialTerm,
  removeWordIgnored,
  resolveWordFlags,
  setWordIgnored,
  setWordMastered,
  setWordUnmastered,
  updateKnownBaseRank,
} from "../src/shared/settings";

describe("settings resolution", () => {
  test("treats low-rank words as known by default", () => {
    const flags = resolveWordFlags("apple", 120, DEFAULT_SETTINGS);
    expect(flags.isKnown).toBe(true);
    expect(flags.shouldTranslate).toBe(false);
  });

  test("lets users force a base word back to unmastered", () => {
    const settings = setWordUnmastered(DEFAULT_SETTINGS, "apple", 120);
    const flags = resolveWordFlags("apple", 120, settings);
    expect(flags.isKnown).toBe(false);
    expect(flags.shouldTranslate).toBe(true);
  });

  test("keeps out-of-list words in the review set once manually unmastered", () => {
    const settings = setWordUnmastered(DEFAULT_SETTINGS, "tailwindcss", null);
    const flags = resolveWordFlags("tailwindcss", null, settings, "tailwindcss");
    expect(settings.unmasteredOverrides).toContain("tailwindcss");
    expect(flags.shouldTranslate).toBe(true);
  });

  test("lets users add out-of-list words to mastered", () => {
    const settings = setWordMastered(DEFAULT_SETTINGS, "tailwindcss");
    const flags = resolveWordFlags("tailwindcss", null, settings);
    expect(flags.isKnown).toBe(true);
  });

  test("treats common inflections as the same mastered word", () => {
    const settings = setWordMastered(DEFAULT_SETTINGS, "add");
    expect(settings.masteredOverrides).toContain("add");
    expect(resolveWordFlags("add", lookupRank("add"), settings, "add").isKnown).toBe(true);
    expect(resolveWordFlags("added", lookupRank("added"), settings, "added").isKnown).toBe(true);
    expect(resolveWordFlags("adding", lookupRank("adding"), settings, "adding").isKnown).toBe(true);
    expect(resolveWordFlags("adds", lookupRank("adds"), settings, "adds").isKnown).toBe(true);
  });

  test("keeps derived words separate from the mastered inflection group", () => {
    const settings = setWordMastered(updateKnownBaseRank(DEFAULT_SETTINGS, 0), "add");
    const additionFlags = resolveWordFlags("addition", lookupRank("addition"), settings, "addition");
    const additiveFlags = resolveWordFlags("additive", lookupRank("additive"), settings, "additive");
    expect(additionFlags.isKnown).toBe(false);
    expect(additionFlags.shouldTranslate).toBe(true);
    expect(additiveFlags.isKnown).toBe(false);
    expect(additiveFlags.shouldTranslate).toBe(true);
  });

  test("stores unmastered inflections under the same mastery key", () => {
    const settings = setWordUnmastered(DEFAULT_SETTINGS, "added", lookupRank("added"));
    expect(settings.unmasteredOverrides).toContain("add");
    expect(resolveWordFlags("adding", lookupRank("adding"), settings, "adding").shouldTranslate).toBe(true);
  });

  test("maps -ves plurals back to the mastered base lemma", () => {
    const settings = setWordMastered(DEFAULT_SETTINGS, "life");
    expect(resolveWordFlags("lives", lookupRank("lives"), settings, "lives").isKnown).toBe(true);
  });

  test("ignored words override mastery", () => {
    const settings = setWordIgnored(setWordMastered(DEFAULT_SETTINGS, "chatgpt"), "chatgpt");
    const flags = resolveWordFlags("chatgpt", null, settings, "ChatGPT");
    expect(flags.isIgnored).toBe(true);
    expect(flags.shouldTranslate).toBe(false);
  });

  test("manual unmastered status overrides ignored words", () => {
    const settings = setWordUnmastered(setWordIgnored(DEFAULT_SETTINGS, "chatgpt"), "chatgpt", null);
    const flags = resolveWordFlags("chatgpt", null, settings, "ChatGPT");
    expect(flags.isIgnored).toBe(false);
    expect(flags.shouldTranslate).toBe(true);
  });

  test("removes ignored words cleanly", () => {
    const settings = removeWordIgnored(setWordIgnored(DEFAULT_SETTINGS, "cursor"), "cursor");
    const flags = resolveWordFlags("cursor", 5000, settings);
    expect(flags.isIgnored).toBe(false);
    expect(flags.shouldTranslate).toBe(true);
  });

  test("clamps base rank updates", () => {
    const settings = updateKnownBaseRank(DEFAULT_SETTINGS, 15000);
    expect(settings.knownBaseRank).toBe(10000);
  });

  test("subtracts forced-unmastered base words from total known count", () => {
    const settings = setWordUnmastered(DEFAULT_SETTINGS, "apple", 120);
    expect(countTotalKnown(settings)).toBe(2499);
  });

  test("estimates learner level from total known words", () => {
    expect(estimateLearnerLevel(DEFAULT_SETTINGS)).toBe("A2");
    expect(
      estimateLearnerLevel({
        ...DEFAULT_SETTINGS,
        knownBaseRank: 5200,
      }),
    ).toBe("B2");
  });

  test("treats likely names or branded terms outside the lexicon as ignored", () => {
    expect(looksLikeSpecialTerm("Alice", "alice", null)).toBe(true);
    expect(looksLikeSpecialTerm("ClaudeCode", "claudecode", null)).toBe(true);
    expect(looksLikeSpecialTerm("received", "received", 891)).toBe(false);
  });

  test("treats title-cased low-frequency words and handle-like clusters as ignored", () => {
    expect(looksLikeSpecialTerm("Torvalds", "torvalds", 9000)).toBe(true);
    expect(looksLikeSpecialTerm("swyx", "swyx", null)).toBe(true);
  });

  test("treats common pinyin-like romanization as ignored", () => {
    expect(looksLikeSpecialTerm("zhongguo", "zhongguo", null)).toBe(true);
    expect(looksLikeSpecialTerm("beijing", "beijing", null)).toBe(true);
    expect(looksLikeSpecialTerm("xian", "xian", null)).toBe(true);
    expect(resolveWordFlags("zhongguo", null, DEFAULT_SETTINGS, "zhongguo").isIgnored).toBe(true);
    expect(resolveWordFlags("beijing", null, DEFAULT_SETTINGS, "beijing").shouldTranslate).toBe(false);
  });
});
