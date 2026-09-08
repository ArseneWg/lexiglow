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
    expect(migrated.learningProgress.work?.status).toBe("known");
    expect(migrated.learningProgress.go?.status).toBe("learning");
  });

  test("repairs partially corrupted fields instead of propagating invalid state", () => {
    const migrated = sanitizeSettings({
      schemaVersion: 1,
      knownBaseRank: Number.NaN,
      masteredOverrides: ["news", "news"],
      unmasteredOverrides: ["morning"],
      ignoredWords: [],
      wordReviewTrigger: "selection",
      learningProgress: {
        news: {
          status: "known",
          familiarity: 99,
          exposures: -4,
          successes: -1,
          lastSeenAt: Number.NaN,
        },
      },
    });

    expect(migrated.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(Number.isFinite(migrated.knownBaseRank)).toBe(true);
    expect(migrated.masteredOverrides).toEqual(["news"]);
    expect(migrated.unmasteredOverrides).toEqual(["morning"]);
    expect(migrated.learningProgress.news).toEqual(expect.objectContaining({
      status: "known",
      familiarity: 1,
      exposures: 0,
      successes: 0,
    }));
    expect(migrated.learningProgress.news?.lastSeenAt).toBeUndefined();
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
