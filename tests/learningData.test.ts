import { describe, expect, test } from "vitest";

import {
  createLearningDataExport,
  LEARNING_DATA_EXPORT_VERSION,
  LEARNING_DATA_FORMAT,
  mergeImportedTranslatorSecrets,
  parseLearningDataExport,
  serializeLearningDataExport,
} from "../src/shared/learningData";
import { CURRENT_USER_SETTINGS_SCHEMA_VERSION, DEFAULT_SETTINGS } from "../src/shared/settings";
import { DEFAULT_TRANSLATOR_PROFILE } from "../src/shared/translator";

describe("learning data export", () => {
  test("exports versioned settings without API keys", () => {
    const bundle = createLearningDataExport(
      {
        ...DEFAULT_SETTINGS,
        masteredOverrides: ["obfuscation"],
      },
      {
        activeProfileId: "local",
        profiles: [
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            id: "local",
            name: "Local",
            apiKey: "secret-value",
            providerBaseUrl: "http://localhost:8000/v1",
          },
        ],
      },
      "2026-09-08T12:00:00.000Z",
    );

    expect(bundle).toEqual(expect.objectContaining({
      format: LEARNING_DATA_FORMAT,
      exportVersion: LEARNING_DATA_EXPORT_VERSION,
      exportedAt: "2026-09-08T12:00:00.000Z",
    }));
    expect(bundle.userSettings.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(bundle.userSettings.masteredOverrides).toContain("obfuscation");
    expect(bundle.translatorSettingsState.profiles[0]?.apiKey).toBe("");
    expect(serializeLearningDataExport(bundle)).not.toContain("secret-value");
  });

  test("sanitizes imported legacy-shaped settings into the current schema", () => {
    const bundle = parseLearningDataExport(JSON.stringify({
      format: LEARNING_DATA_FORMAT,
      exportVersion: LEARNING_DATA_EXPORT_VERSION,
      exportedAt: "2026-09-08T12:00:00.000Z",
      userSettings: {
        knownBaseRank: 4321,
        masteredOverrides: ["Worked"],
        unmasteredOverrides: [],
        ignoredWords: [],
        wordReviewTrigger: "doubleClick",
      },
      translatorSettingsState: {
        activeProfileId: DEFAULT_TRANSLATOR_PROFILE.id,
        profiles: [
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            apiKey: "should-be-redacted",
          },
        ],
      },
    }));

    expect(bundle.userSettings.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(bundle.userSettings.masteredOverrides).toContain("work");
    expect(bundle.userSettings.learningProgress.work?.status).toBe("known");
    expect(bundle.translatorSettingsState.profiles[0]?.apiKey).toBe("");
  });

  test("rejects unrelated, future, malformed, and oversized imports", () => {
    expect(() => parseLearningDataExport("not-json")).toThrow(/valid JSON/i);
    expect(() => parseLearningDataExport({ format: "other", exportVersion: 1, userSettings: {} }))
      .toThrow(/not a LexiGlow/i);
    expect(() => parseLearningDataExport({
      format: LEARNING_DATA_FORMAT,
      exportVersion: 999,
      userSettings: {},
    })).toThrow(/not supported/i);
    expect(() => parseLearningDataExport(" ".repeat(5_000_001))).toThrow(/too large/i);
  });

  test("preserves only same-profile local secrets during import", () => {
    const merged = mergeImportedTranslatorSecrets(
      {
        activeProfileId: "local",
        profiles: [
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            id: "local",
            name: "Imported Local",
            apiKey: "",
          },
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            id: "new-profile",
            name: "New",
            apiKey: "",
          },
        ],
      },
      {
        activeProfileId: "local",
        profiles: [
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            id: "local",
            name: "Existing Local",
            apiKey: "keep-me",
          },
          {
            ...DEFAULT_TRANSLATOR_PROFILE,
            id: "removed-profile",
            name: "Removed",
            apiKey: "do-not-transfer",
          },
        ],
      },
    );

    expect(merged.profiles.find((profile) => profile.id === "local")?.apiKey).toBe("keep-me");
    expect(merged.profiles.find((profile) => profile.id === "new-profile")?.apiKey).toBe("");
    expect(merged.profiles.some((profile) => profile.apiKey === "do-not-transfer")).toBe(false);
  });
});
