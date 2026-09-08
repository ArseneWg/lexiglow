import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  readUserSettings,
  seedTranslatorSettings,
  seedUserSettings,
} from "./helpers";

test.beforeEach(async ({ extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
});

test("Options exports a secret-free backup and restores learning data without losing the local profile key", async ({
  context,
  extensionWorker,
  extensionId,
}) => {
  await seedUserSettings(extensionWorker, {
    knownBaseRank: 2750,
    masteredOverrides: ["obfuscation"],
    ignoredWords: ["boilerplate"],
    learningProgress: {
      obfuscation: {
        status: "known",
        familiarity: 1,
        exposures: 3,
        successes: 2,
      },
      boilerplate: {
        status: "ignored",
        familiarity: 0,
        exposures: 0,
        successes: 0,
      },
    },
  });
  await seedTranslatorSettings(extensionWorker, {
    providerBaseUrl: "http://llm.test/v1",
    providerModel: "portable-model",
    apiKey: "e2e-local-secret",
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await expect(options.locator("#exportDataButton")).toBeVisible();
  await expect(options.locator("#providerApiKey")).toHaveValue("e2e-local-secret");

  const downloadPromise = options.waitForEvent("download");
  await options.locator("#exportDataButton").click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  expect(exportPath).not.toBeNull();
  const exportedText = await readFile(exportPath!, "utf8");
  const exported = JSON.parse(exportedText) as {
    format?: string;
    exportVersion?: number;
    userSettings?: Record<string, unknown>;
    translatorSettingsState?: {
      activeProfileId?: string;
      profiles?: Array<Record<string, unknown>>;
    };
  };

  expect(exported.format).toBe("lexiglow-learning-data");
  expect(exported.exportVersion).toBe(1);
  expect(exportedText).not.toContain("e2e-local-secret");
  expect(exported.userSettings).toEqual(expect.objectContaining({
    knownBaseRank: 2750,
    masteredOverrides: expect.arrayContaining(["obfuscation"]),
    ignoredWords: expect.arrayContaining(["boilerplate"]),
  }));
  expect(exported.translatorSettingsState?.profiles?.[0]).toEqual(expect.objectContaining({
    providerModel: "portable-model",
    apiKey: "",
  }));

  const importPayload = {
    ...exported,
    userSettings: {
      ...(exported.userSettings ?? {}),
      knownBaseRank: 4100,
      masteredOverrides: ["circumlocution"],
      unmasteredOverrides: ["obfuscation"],
      ignoredWords: [],
      learningProgress: {
        circumlocution: {
          status: "known",
          familiarity: 1,
          exposures: 2,
          successes: 1,
        },
        obfuscation: {
          status: "learning",
          familiarity: 0.25,
          exposures: 0,
          successes: 2,
        },
      },
    },
  };

  await options.locator("#importDataInput").setInputFiles({
    name: "lexiglow-learning-data.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importPayload)),
  });

  await expect(options.locator("#rankNumber")).toHaveValue("4100");
  await expect(options.locator("#providerApiKey")).toHaveValue("e2e-local-secret");
  await expect(options.locator('[data-mastered="circumlocution"]')).toBeVisible();

  const stored = await readUserSettings(extensionWorker);
  expect(stored).toEqual(expect.objectContaining({
    schemaVersion: 2,
    knownBaseRank: 4100,
    masteredOverrides: expect.arrayContaining(["circumlocution"]),
    unmasteredOverrides: expect.arrayContaining(["obfuscation"]),
  }));

  const publicTranslatorState = await extensionWorker.evaluate(async () => {
    const result = await chrome.storage.local.get("translatorSettings");
    return result.translatorSettings as {
      profiles?: Array<{ apiKey?: string }>;
    } | undefined;
  });
  expect(publicTranslatorState?.profiles?.[0]?.apiKey).toBe("");
});
