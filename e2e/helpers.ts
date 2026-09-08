import type { BrowserContext, Page, Worker } from "@playwright/test";

const TEST_ORIGIN = "https://lexiglow.test";
const HIGHLIGHT_NAMES = [
  "wordwise-pending-strong",
  "wordwise-pending",
  "wordwise-pending-weak",
] as const;

export interface SeedUserSettings {
  knownBaseRank?: number;
  masteredOverrides?: string[];
  unmasteredOverrides?: string[];
  ignoredWords?: string[];
  wordReviewTrigger?: "doubleClick" | "selection";
  learningProgress?: Record<string, unknown>;
}

export interface SeedTranslatorSettings {
  defaultTranslationProvider?: "google" | "llm";
  llmProvider?: "openai" | "gemini" | "claude";
  providerBaseUrl?: string;
  providerModel?: string;
  apiKey?: string;
  fallbackToGoogle?: boolean;
  learnerLanguageCode?: string;
  llmDisplayMode?: "word" | "sentence" | "english";
  cacheDurationValue?: number;
  cacheDurationUnit?: "minutes" | "hours";
}

export async function clearExtensionStorage(worker: Worker) {
  await worker.evaluate(async () => {
    await chrome.storage.local.clear();
  });
}

export async function seedUserSettings(worker: Worker, overrides: SeedUserSettings = {}) {
  const value = {
    knownBaseRank: 2500,
    masteredOverrides: [],
    unmasteredOverrides: [],
    ignoredWords: [],
    wordReviewTrigger: "doubleClick" as const,
    learningProgress: {},
    ...overrides,
  };

  await worker.evaluate(async (settings) => {
    await chrome.storage.local.set({ userSettings: settings });
  }, value);
}

export async function seedTranslatorSettings(
  worker: Worker,
  overrides: SeedTranslatorSettings = {},
) {
  const profile = {
    id: "e2e-profile",
    name: "E2E",
    defaultTranslationProvider: "google" as const,
    llmProvider: "openai" as const,
    providerBaseUrl: "http://llm.test/v1",
    providerModel: "e2e-model",
    apiKey: "",
    fallbackToGoogle: false,
    learnerLanguageCode: "zh-CN",
    llmDisplayMode: "word" as const,
    cacheDurationValue: 1,
    cacheDurationUnit: "minutes" as const,
    ...overrides,
  };

  await worker.evaluate(async (translatorProfile) => {
    await chrome.storage.local.set({
      translatorSettings: {
        activeProfileId: translatorProfile.id,
        profiles: [translatorProfile],
      },
    });
  }, profile);
}

export async function readUserSettings(worker: Worker) {
  return worker.evaluate(async () => {
    const result = await chrome.storage.local.get("userSettings");
    return result.userSettings as Record<string, unknown> | undefined;
  });
}

export async function mockDictionaryFailures(context: BrowserContext) {
  await context.route("https://api.dictionaryapi.dev/**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: "{}",
    });
  });
}

export async function mockGoogleTranslation(
  context: BrowserContext,
  translation = "E2E 翻译",
) {
  await context.route("https://translate.googleapis.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([[[translation]]]),
    });
  });
}

export async function serveTestPage(
  context: BrowserContext,
  page: Page,
  body: string,
  extraStyle = "",
) {
  await context.route(`${TEST_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/favicon.ico") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 32px; font: 18px/1.6 Arial, sans-serif; }
    p { max-width: 980px; }
    ${extraStyle}
  </style>
</head>
<body>${body}</body>
</html>`,
    });
  });

  await page.goto(`${TEST_ORIGIN}/`, { waitUntil: "domcontentloaded" });
}

export async function selectElementText(page: Page, selector: string) {
  await page.locator(selector).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new Event("selectionchange"));
    const rect = range.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
  });
}

export async function getHighlightTexts(page: Page): Promise<string[]> {
  return page.evaluate((names) => {
    const registry = (CSS as unknown as {
      highlights?: { get(name: string): Iterable<Range> | undefined };
    }).highlights;
    if (!registry) {
      return [];
    }

    const values: string[] = [];
    for (const name of names) {
      const highlight = registry.get(name);
      if (!highlight) {
        continue;
      }
      for (const range of highlight) {
        values.push(range.toString());
      }
    }
    return values;
  }, [...HIGHLIGHT_NAMES]);
}

export async function getHighlightCount(page: Page): Promise<number> {
  return (await getHighlightTexts(page)).length;
}

export function openAiResponse(content: unknown) {
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: typeof content === "string" ? content : JSON.stringify(content),
        },
      },
    ],
  });
}
