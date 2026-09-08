import { describe, expect, test } from "vitest";

import {
  DEFAULT_SETTINGS,
  getHighlightIntensity,
  recordLearningExposure,
  resolveWordFlags,
  sanitizeSettings,
  setWordMastered,
  setWordUnmastered,
} from "../src/shared/settings";

describe("familiarity-aware learning progress", () => {
  test("backfills progress for legacy override data", () => {
    const settings = sanitizeSettings({
      knownBaseRank: 2500,
      masteredOverrides: ["translate"],
      unmasteredOverrides: ["work"],
      ignoredWords: [],
      wordReviewTrigger: "doubleClick",
    });

    expect(settings.learningProgress.translate).toEqual(
      expect.objectContaining({ status: "known", familiarity: 1 }),
    );
    expect(settings.learningProgress.work).toEqual(
      expect.objectContaining({ status: "learning", familiarity: 0.25 }),
    );
  });

  test("relearning creates a due learning state", () => {
    const settings = setWordUnmastered(DEFAULT_SETTINGS, "worked", 2000);
    const progress = settings.learningProgress.work;

    expect(settings.unmasteredOverrides).toContain("work");
    expect(progress.status).toBe("learning");
    expect(progress.exposures).toBe(0);
    expect(progress.nextReviewAt).toBeDefined();
    expect(resolveWordFlags("work", 100, settings, "worked").shouldTranslate).toBe(true);
  });

  test("spaced exposures raise familiarity without silently mastering the word", () => {
    const baseNow = 1_800_000_000_000;
    let settings = setWordUnmastered(DEFAULT_SETTINGS, "work", 100);

    for (let index = 1; index <= 5; index += 1) {
      settings = recordLearningExposure(settings, "worked", baseNow + index * 7 * 60 * 60 * 1000);
    }

    const progress = settings.learningProgress.work;
    expect(progress.exposures).toBe(5);
    expect(progress.familiarity).toBeGreaterThan(0.6);
    expect(settings.unmasteredOverrides).toContain("work");
    expect(getHighlightIntensity(settings, "worked", 1)).toBe("weak");
  });

  test("well-exposed relearning words rest between review intervals and return when due", () => {
    const baseNow = 1_800_000_000_000;
    let settings = setWordUnmastered(DEFAULT_SETTINGS, "work", 100);

    for (let index = 1; index <= 6; index += 1) {
      settings = recordLearningExposure(settings, "worked", baseNow + index * 7 * 60 * 60 * 1000);
    }

    expect(settings.learningProgress.work.exposures).toBe(6);
    expect(settings.learningProgress.work.familiarity).toBeGreaterThanOrEqual(0.75);
    expect(getHighlightIntensity(settings, "worked", 1)).toBe("none");
    expect(getHighlightIntensity(settings, "worked", 3)).toBe("weak");

    const dueSettings = sanitizeSettings({
      ...settings,
      learningProgress: {
        ...settings.learningProgress,
        work: {
          ...settings.learningProgress.work,
          nextReviewAt: Date.now() - 1,
        },
      },
    });

    expect(getHighlightIntensity(dueSettings, "worked", 1)).toBe("strong");
  });

  test("explicit mastery remains the authoritative completion action", () => {
    const relearning = setWordUnmastered(DEFAULT_SETTINGS, "work", 100);
    const mastered = setWordMastered(relearning, "worked");

    expect(mastered.masteredOverrides).toContain("work");
    expect(mastered.unmasteredOverrides).not.toContain("work");
    expect(mastered.learningProgress.work).toEqual(
      expect.objectContaining({ status: "known", familiarity: 1 }),
    );
  });

  test("article repetition promotes otherwise-normal unknown words", () => {
    expect(getHighlightIntensity(DEFAULT_SETTINGS, "obfuscation", 1)).toBe("normal");
    expect(getHighlightIntensity(DEFAULT_SETTINGS, "obfuscation", 3)).toBe("strong");
  });
});
