import { describe, expect, test } from "vitest";

import {
  DEFAULT_SETTINGS,
  getHighlightIntensity,
  recordLearningExposure,
  resolveWordFlags,
  setWordMastered,
  setWordUnmastered,
} from "../src/shared/settings";

describe("simple learning state", () => {
  test("relearning turns a previously known word back into an explicit unknown word", () => {
    const mastered = setWordMastered(DEFAULT_SETTINGS, "worked");
    const relearning = setWordUnmastered(mastered, "worked", 2000);

    expect(relearning.masteredOverrides).not.toContain("work");
    expect(relearning.unmasteredOverrides).toContain("work");
    expect(resolveWordFlags("work", 100, relearning, "worked").shouldTranslate).toBe(true);
  });

  test("translation requests do not mutate long-term learning state", () => {
    const unknown = setWordUnmastered(DEFAULT_SETTINGS, "work", 100);
    let settings = unknown;

    for (let index = 1; index <= 20; index += 1) {
      settings = recordLearningExposure(settings, "worked", 1_800_000_000_000 + index * 24 * 60 * 60 * 1000);
    }

    expect(settings).toBe(unknown);
    expect(settings.unmasteredOverrides).toContain("work");
    expect(resolveWordFlags("work", 100, settings, "worked").shouldTranslate).toBe(true);
    expect(getHighlightIntensity(settings, "worked", 1)).toBe("normal");
  });

  test("explicit mastery is the only action that completes learning", () => {
    const unknown = setWordUnmastered(DEFAULT_SETTINGS, "work", 100);
    const mastered = setWordMastered(unknown, "worked");

    expect(mastered.masteredOverrides).toContain("work");
    expect(mastered.unmasteredOverrides).not.toContain("work");
    expect(resolveWordFlags("work", 100, mastered, "worked").isKnown).toBe(true);
  });

  test("article repetition only changes current-page highlight priority", () => {
    const unknown = setWordUnmastered(DEFAULT_SETTINGS, "obfuscation", null);

    expect(getHighlightIntensity(unknown, "obfuscation", 1)).toBe("normal");
    expect(getHighlightIntensity(unknown, "obfuscation", 2)).toBe("normal");
    expect(getHighlightIntensity(unknown, "obfuscation", 3)).toBe("strong");
    expect(unknown.unmasteredOverrides).toContain("obfuscation");
  });
});
