import { describe, expect, test } from "vitest";

import {
  CURRENT_USER_SETTINGS_SCHEMA_VERSION,
  sanitizeSettings,
} from "../src/shared/settings";

describe("user settings schema", () => {
  test("migrates unversioned legacy settings to the current schema", () => {
    const migrated = sanitizeSettings({
      knownBaseRank: 3200,
      masteredOverrides: ["Worked"],
      unmasteredOverrides: ["went"],
      ignoredWords: ["ChatGPT"],
      wordReviewTrigger: "doubleClick",
    });

    expect(migrated.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(migrated.masteredOverrides).toContain("work");
    expect(migrated.unmasteredOverrides).toContain("go");
  });

  test("drops legacy familiarity and review-scheduling data", () => {
    const legacy = {
      schemaVersion: 2,
      knownBaseRank: Number.NaN,
      masteredOverrides: ["news", "news"],
      unmasteredOverrides: ["morning"],
      ignoredWords: [],
      wordReviewTrigger: "selection" as const,
      learningProgress: {
        news: {
          status: "known",
          familiarity: 1,
          exposures: 42,
          successes: 9,
          nextReviewAt: Date.now() + 86_400_000,
        },
      },
    };

    const migrated = sanitizeSettings(legacy);

    expect(migrated.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(Number.isFinite(migrated.knownBaseRank)).toBe(true);
    expect(migrated.masteredOverrides).toEqual(["news"]);
    expect(migrated.unmasteredOverrides).toEqual(["morning"]);
    expect("learningProgress" in migrated).toBe(false);
  });

  test("migration is idempotent", () => {
    const first = sanitizeSettings({
      knownBaseRank: 4100,
      masteredOverrides: ["written"],
      unmasteredOverrides: ["children"],
      ignoredWords: [],
      wordReviewTrigger: "selection",
    });
    const second = sanitizeSettings(first);

    expect(second).toEqual(first);
  });
});
