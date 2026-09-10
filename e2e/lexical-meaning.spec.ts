import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  openAiResponse,
  seedTranslatorSettings,
  seedUserSettings,
  selectElementText,
  serveTestPage,
} from "./helpers";

test.beforeEach(async ({ extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    providerBaseUrl: "http://llm.test/v1",
    providerModel: "test-model",
    apiKey: "",
    learnerLanguageCode: "zh-CN",
    llmDisplayMode: "word",
    fallbackToGoogle: false,
  });
});

test("single-word selection uses the lexical pipeline and renders sense metadata", async ({ context, page }) => {
  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {
    const url = route.request().url();
    const body = url.endsWith("/collapses.jsonl")
      ? JSON.stringify({ word: "collapses", pos: "verb", senses: [{ tags: ["form-of"], form_of: [{ word: "collapse" }], glosses: ["third-person singular of collapse"] }] })
      : url.endsWith("/collapse.jsonl")
        ? JSON.stringify({ word: "collapse", pos: "verb", senses: [
            {
              glosses: ["to fail completely, as a system or organization"],
              translations: [{ lang_code: "zh", word: "瓦解" }],
            },
            {
              glosses: ["to fall down suddenly, as a building or structure"],
              translations: [{ lang_code: "zh", word: "倒塌" }],
            },
          ] })
        : "";
    await route.fulfill({ status: body ? 200 : 404, contentType: "application/jsonl", body });
  });
  await context.route("http://llm.test/v1/chat/completions", async (route) => {
    const post = route.request().postDataJSON() as any;
    expect(JSON.stringify(post)).toContain("dictionary_senses");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse(JSON.stringify({
        word: "瓦解",
        pos: "verb",
        hint: "系统或机制突然失效",
      })),
    });
  });

  await serveTestPage(context, page, '<p>The mechanism <span id="target">collapses</span> under this constraint.</p>');
  await selectElementText(page, "#target");
  await expect(page.locator(".wordwise-primary-translation")).toContainText("瓦解");
  await expect(page.locator(".wordwise-word-form")).toContainText("collapse · 3sg");
  await expect(page.locator(".wordwise-semantic-hint")).toContainText("系统或机制突然失效");
  await page.locator(".wordwise-other-meanings summary").click();
  await expect(page.locator(".wordwise-other-meanings-list")).toContainText("倒塌");
  await expect(page.locator(".wordwise-other-meanings-list")).toContainText("fall down suddenly");
});
