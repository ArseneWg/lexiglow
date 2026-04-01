import { describe, expect, test } from "vitest";

import {
  DEFAULT_SETTINGS,
  countTotalKnown,
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

  test("treats likely names or branded terms outside the lexicon as ignored", () => {
    expect(looksLikeSpecialTerm("Alice", "alice", null)).toBe(true);
    expect(looksLikeSpecialTerm("ClaudeCode", "claudecode", null)).toBe(true);
    expect(looksLikeSpecialTerm("received", "received", 891)).toBe(false);
  });
});
