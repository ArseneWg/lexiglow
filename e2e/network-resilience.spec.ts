import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  mockDictionaryFailures,
  openAiResponse,
  seedTranslatorSettings,
  seedUserSettings,
  selectElementText,
  serveTestPage,
} from "./helpers";

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await mockDictionaryFailures(context);
});

for (const failure of [
  { name: "429 rate limit", fulfill: { status: 429, body: JSON.stringify({ error: "rate limited" }) } },
  { name: "malformed JSON", fulfill: { status: 200, body: "{" } },
] as const) {
  test(`LLM ${failure.name} falls back to Google when configured`, async ({
    context,
    page,
    extensionWorker,
  }) => {
    await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
    await seedTranslatorSettings(extensionWorker, {
      defaultTranslationProvider: "llm",
      fallbackToGoogle: true,
      providerBaseUrl: "http://llm.test/v1",
      apiKey: "",
    });

    let llmCalls = 0;
    let googleCalls = 0;
    await context.route("http://llm.test/**", async (route) => {
      llmCalls += 1;
      await route.fulfill({
        status: failure.fulfill.status,
        contentType: "application/json",
        body: failure.fulfill.body,
      });
    });
    await context.route("https://translate.googleapis.com/**", async (route) => {
      googleCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([[["回退成功"]]]),
      });
    });

    await serveTestPage(context, page, '<p>We study <span id="target">obfuscation</span> carefully.</p>');
    await page.locator("#target").hover();

    await expect(page.locator(".wordwise-primary-translation")).toContainText("回退成功");
    expect(llmCalls).toBe(1);
    expect(googleCalls).toBe(1);
  });
}

test("LLM authentication failure without fallback stays a visible non-destructive error", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    fallbackToGoogle: false,
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });

  let googleCalls = 0;
  await context.route("http://llm.test/**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthorized" }),
    });
  });
  await context.route("https://translate.googleapis.com/**", async (route) => {
    googleCalls += 1;
    await route.abort();
  });

  await serveTestPage(context, page, '<p>We study <span id="target">obfuscation</span> carefully.</p>');
  await page.locator("#target").hover();

  await expect(page.locator(".wordwise-primary-translation")).toContainText("翻译暂不可用");
  await expect(page.locator(".wordwise-card")).toBeVisible();
  expect(googleCalls).toBe(0);
});

test("a slower stale hover response cannot overwrite the newer word tooltip", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, { defaultTranslationProvider: "google" });

  let firstStarted = false;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await context.route("https://translate.googleapis.com/**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    if (query === "obfuscation") {
      firstStarted = true;
      await firstGate;
    }
    const translation = query === "circumlocution" ? "第二个结果" : "过期的第一个结果";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([[[translation]]]),
    });
  });

  await serveTestPage(
    context,
    page,
    '<p><span id="first">obfuscation</span> then <span id="second">circumlocution</span>.</p>',
  );

  await page.locator("#first").hover();
  await expect.poll(() => firstStarted).toBe(true);
  await page.locator("#second").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("第二个结果");

  releaseFirst();
  await page.waitForTimeout(350);
  await expect(page.locator(".wordwise-primary-translation")).toContainText("第二个结果");
  await expect(page.locator(".wordwise-primary-translation")).not.toContainText("过期的第一个结果");
});

test("closing a selection tooltip prevents a late LLM response from resurrecting it", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    fallbackToGoogle: false,
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });

  let requestStarted = false;
  let releaseRequest!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await context.route("http://llm.test/**", async (route) => {
    requestStarted = true;
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "迟到的结果" }),
    });
  });

  await serveTestPage(
    context,
    page,
    '<p id="selection">This selected phrase should stay closed after Escape.</p>',
  );
  await selectElementText(page, "#selection");
  await expect.poll(() => requestStarted).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator(".wordwise-card")).toBeHidden();
  releaseRequest();
  await page.waitForTimeout(350);
  await expect(page.locator(".wordwise-card")).toBeHidden();
});
