import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  getHighlightTexts,
  mockDictionaryFailures,
  mockGoogleTranslation,
  openAiResponse,
  readUserSettings,
  seedTranslatorSettings,
  seedUserSettings,
  selectElementText,
  serveTestPage,
} from "./helpers";

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await mockDictionaryFailures(context);
});

test("Ignore hides a word and removing it from Options restores the highlight", async ({
  context,
  page,
  extensionWorker,
  extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "混淆");
  await serveTestPage(context, page, '<p>We study <span id="target">obfuscation</span> carefully.</p>');

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(true);
  await page.locator("#target").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("混淆");
  await page.getByRole("button", { name: "忽略", exact: true }).click();

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(false);
  expect((await readUserSettings(extensionWorker))?.ignoredWords).toEqual(
    expect.arrayContaining(["obfuscation"]),
  );

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await expect(options.locator('[data-ignored="obfuscation"]')).toBeVisible();
  await options.locator('[data-ignored="obfuscation"] [data-action="remove-ignored"]').click();

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(true);
  expect((await readUserSettings(extensionWorker))?.ignoredWords).not.toContain("obfuscation");
  await options.close();
});

test("inflected learning phrases share one canonical mastery key", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "占比");
  await serveTestPage(
    context,
    page,
    '<p>The losses <span id="phrase">accounted for</span> most of the variance.</p>',
  );

  await expect.poll(async () => (await getHighlightTexts(page)).includes("accounted for")).toBe(true);
  await page.locator("#phrase").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("占比");
  await page.getByRole("button", { name: "已掌握", exact: true }).click();

  const settings = await readUserSettings(extensionWorker);
  expect(settings?.masteredOverrides).toEqual(expect.arrayContaining(["account for"]));
  expect(settings?.masteredOverrides).not.toContain("accounted for");

  await page.locator("#phrase").evaluate((element) => {
    element.textContent = "account for";
  });
  await expect.poll(async () => (await getHighlightTexts(page)).includes("account for")).toBe(false);
});

test("hyphenated compounds are highlighted and translated as one lexical unit", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  let translatedSource = "";

  await context.route("https://translate.googleapis.com/**", async (route) => {
    const url = new URL(route.request().url());
    translatedSource = url.searchParams.get("q") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([[["混合精度"]]]),
    });
  });

  await serveTestPage(
    context,
    page,
    '<p>Use <span id="compound">mixed-precision</span> training for this run.</p>',
  );

  await expect.poll(async () => (await getHighlightTexts(page)).includes("mixed-precision")).toBe(true);
  const highlights = await getHighlightTexts(page);
  expect(highlights).not.toContain("mixed");
  expect(highlights).not.toContain("precision");

  await page.locator("#compound").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("混合精度");
  expect(translatedSource).toBe("mixed-precision");
});

test("explicitly selected Title Case phrases are translated instead of silently preserved", async ({
  context,
  page,
}) => {
  let translatedSource = "";
  await context.route("https://translate.googleapis.com/**", async (route) => {
    const url = new URL(route.request().url());
    translatedSource = url.searchParams.get("q") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([[["机器学习"]]]),
    });
  });

  await serveTestPage(context, page, '<p id="selection">Machine Learning</p>');
  await selectElementText(page, "#selection");

  await expect(page.locator(".wordwise-primary-translation")).toContainText("机器学习");
  expect(translatedSource).toBe("Machine Learning");
});

test("a user can switch the same lookup from Google to contextual LLM and back", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "google",
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });
  await mockGoogleTranslation(context, "快速译文");

  let llmCalls = 0;
  await context.route("http://llm.test/**", async (route) => {
    llmCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "语境译文", pos: "noun" }),
    });
  });

  await serveTestPage(
    context,
    page,
    '<p>The author uses <span id="target">obfuscation</span> deliberately.</p>',
  );
  await page.locator("#target").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("快速译文");

  await page.getByRole("button", { name: "语境翻译", exact: true }).click();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("语境译文");
  expect(llmCalls).toBe(1);

  await page.getByRole("button", { name: "Google", exact: true }).click();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("快速译文");
});

test("overlong selections keep limit feedback visible without sending translation traffic", async ({
  context,
  page,
}) => {
  const longSelection = `${"This deliberately long English selection should be rejected before translation. ".repeat(20)}TAIL`;
  expect(longSelection.length).toBeGreaterThan(1200);

  let translationCalls = 0;
  await context.route("https://translate.googleapis.com/**", async (route) => {
    translationCalls += 1;
    await route.abort();
  });
  await context.route("http://llm.test/**", async (route) => {
    translationCalls += 1;
    await route.abort();
  });

  await serveTestPage(context, page, `<p id="selection">${longSelection}</p>`);
  await selectElementText(page, "#selection");

  await expect(page.locator(".wordwise-translation")).toBeVisible();
  const hint = page.getByText("划选内容过长，请控制在 1200 个字符以内。", { exact: true });
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((element) => getComputedStyle(element.parentElement!).display)).not.toBe("none");
  expect(translationCalls).toBe(0);
});
