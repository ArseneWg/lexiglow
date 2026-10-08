import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { clearExtensionStorage, getHighlightTexts, mockDictionaryFailures, mockGoogleTranslation,
  openAiResponse, readUserSettings, seedTranslatorSettings, seedUserSettings, selectElementText, serveTestPage } from "./helpers";

async function capture(page: Page, name: string) {
  const directory = process.env.LEXIGLOW_AUDIT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}
async function storedTranslator(page: Page) {
  return page.evaluate(async () => (await chrome.storage.local.get("translatorSettings")).translatorSettings);
}
async function form(page: Page) {
  return page.locator("#translatorFields").evaluate((element) => [...element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")]
    .map((input) => [input.id, input.value, input instanceof HTMLInputElement ? input.checked : false]));
}
async function backup(page: Page) {
  const data = await page.evaluate(async () => chrome.storage.local.get(["userSettings", "translatorSettings"]));
  return { format: "lexiglow-learning-data", exportVersion: 1, exportedAt: "2026-10-08T00:00:00Z",
    userSettings: data.userSettings, translatorSettingsState: data.translatorSettings };
}
async function importPayload(page: Page, data: unknown) {
  await page.locator("#importDataInput").setInputFiles({ name: "test-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
}

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker);
  await seedTranslatorSettings(extensionWorker);
  await mockDictionaryFailures(context);
  // These tests never depend on public dictionary traffic or provider credentials.
  await context.route("https://kaikki.org/**", (route) => route.fulfill({ status: 404, body: "" }));
});

test("all translator drafts survive repeated learning operations without being persisted until Save", async ({ context, extensionWorker, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  const before = await storedTranslator(page);
  await page.locator("#learnerLanguageCode").selectOption("fr");
  await page.locator("#defaultTranslationProvider").selectOption("llm");
  await page.locator("#providerBaseUrl").fill("http://draft.test/v1");
  await page.locator("#providerModel").fill("unsaved-draft");
  await page.locator("#providerApiKey").fill("synthetic-draft-key");
  await page.locator("#llmDisplayMode").selectOption("english");
  await page.locator("#cacheDurationValue").fill("2");
  await page.locator("#cacheDurationUnit").selectOption("hours");
  await page.locator("#fallbackToGoogle").check();
  const draft = await form(page);
  for (const rank of [2600, 2700]) {
    await page.locator("#rankNumber").fill(String(rank));
    await page.locator("#rankNumber").blur();
    await expect.poll(async () => (await readUserSettings(extensionWorker))?.knownBaseRank).toBe(rank);
    await page.locator("#wordReviewTrigger").selectOption(rank === 2600 ? "selection" : "doubleClick");
    await page.locator("#searchInput").fill("obfuscation");
    const row = page.locator('[data-lemma="obfuscation"]');
    await row.locator('[data-action="toggle-known"]').click();
    await row.locator('[data-action="toggle-ignored"]').click();
    await page.locator('[data-ignored="obfuscation"] [data-action="remove-ignored"]').click();
    expect(await form(page)).toEqual(draft);
    expect(await storedTranslator(page)).toEqual(before);
  }
  await capture(page, "01-preserved-draft");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#translatorStatus")).toHaveAttribute("data-kind", "success");
  await page.reload();
  await expect(page.locator("#providerModel")).toHaveValue("unsaved-draft");
  await expect(page.locator("#providerApiKey")).toHaveValue("synthetic-draft-key");
  await expect(page.locator("#rankNumber")).toHaveValue("2700");
});

test("pending Save disables edits, then restores controls and permits the next save", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((message: unknown) => new Promise((resolve) => setTimeout(() => resolve(original(message)), 400))) as typeof chrome.runtime.sendMessage;
  });
  await page.locator("#providerModel").fill("saved-one");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#providerModel")).toBeDisabled();
  await expect(page.locator("#newProfileButton")).toBeDisabled();
  await expect(page.locator("#providerModel")).toBeEnabled();
  await page.locator("#providerModel").fill("saved-two");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#providerModel")).toBeEnabled();
  await page.reload();
  await expect(page.locator("#providerModel")).toHaveValue("saved-two");
  await page.evaluate(() => { chrome.runtime.sendMessage = (() => Promise.reject(new Error("Synthetic save failure"))) as typeof chrome.runtime.sendMessage; });
  await page.locator("#providerModel").fill("failed-draft");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#translatorStatus")).toHaveAttribute("data-kind", "error");
  await expect(page.locator("#learningStatus")).toBeEmpty();
  await expect(page.locator("#providerModel")).toBeEnabled();
  await expect(page.locator("#providerModel")).toHaveValue("failed-draft");
  await page.reload();
  await expect(page.locator("#providerModel")).toHaveValue("saved-two");
});

test("reset cancellation preserves drafts and data; accepted and repeated resets persist only learning reset", async ({ context, extensionWorker, extensionId }) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 2750, wordReviewTrigger: "selection", masteredOverrides: ["obfuscation"], unmasteredOverrides: ["work"], ignoredWords: ["boilerplate"] });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await page.locator("#providerModel").fill("unsaved-reset-draft");
  const before = await readUserSettings(extensionWorker);
  const draft = await form(page);
  page.once("dialog", (dialog) => { expect(dialog.message()).toContain("复习触发方式"); return dialog.dismiss(); });
  await page.locator("#clearButton").click();
  await expect(page.locator("#resetStatus")).toContainText("已取消");
  expect(await readUserSettings(extensionWorker)).toEqual(before);
  expect(await form(page)).toEqual(draft);
  for (let i = 0; i < 2; i++) {
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#clearButton").click();
    await expect(page.locator("#resetStatus")).toContainText("已重置");
    expect(await form(page)).toEqual(draft);
  }
  await page.reload();
  expect(await readUserSettings(extensionWorker)).toEqual(expect.objectContaining({ knownBaseRank: 2750, wordReviewTrigger: "selection", masteredOverrides: [], unmasteredOverrides: [], ignoredWords: [], learningProgress: {} }));
  await capture(page, "02-reset-confirmed");
});

test("import cancellation, same-file retry and endpoint change protect data and local credentials", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await page.locator("#providerApiKey").fill("synthetic-private-key");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#providerApiKey")).toBeEnabled();
  const before = await backup(page);
  const imported = structuredClone(before);
  imported.userSettings.knownBaseRank = 4100;
  imported.translatorSettingsState.profiles[0].providerBaseUrl = "http://changed.test/v1";
  imported.translatorSettingsState.profiles[0].name = '</option><img src=x onerror="throw new Error(1)">';
  await page.locator("#providerModel").fill("keep-cancelled-draft");
  const draft = await form(page);
  page.once("dialog", (dialog) => { expect(dialog.message()).toContain("0 个"); return dialog.dismiss(); });
  await importPayload(page, imported);
  await expect(page.locator("#backupStatus")).toContainText("已取消");
  expect(await backup(page)).toEqual(before);
  expect(await form(page)).toEqual(draft);
  await expect(page.locator("#providerApiKey")).toHaveValue("synthetic-private-key");
  for (let i = 0; i < 2; i++) {
    page.once("dialog", (dialog) => dialog.accept());
    await importPayload(page, imported);
    await expect(page.locator("#backupStatus")).toContainText("已导入");
    await expect(page.locator("#providerApiKey")).toHaveValue("");
    await expect(page.locator("#app img")).toHaveCount(0);
  }
  await page.reload();
  await expect(page.locator("#rankNumber")).toHaveValue("4100");
  await expect(page.locator("#providerApiKey")).toHaveValue("");
  await capture(page, "03-import-cleared-key");
});

test("backup errors stay in their section, distinguish size/JSON/format/version, and survive unrelated timers", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await page.locator("#providerModel").fill("unsaved");
  const downloaded = page.waitForEvent("download");
  await page.locator("#exportDataButton").click();
  await downloaded;
  await expect(page.locator("#translatorStatus")).toBeEmpty();
  await expect(page.locator("#learningStatus")).toBeEmpty();
  const payload = await backup(page);
  for (const [data, expected] of [[{}, "不是有效"], [{ ...payload, exportVersion: 99 }, "备份版本"]] as const) {
    await importPayload(page, data);
    await expect(page.locator("#backupStatus")).toContainText(expected);
  }
  await page.locator("#importDataInput").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.locator("#backupStatus")).toContainText("JSON 格式无效");
  await page.locator("#wordReviewTrigger").selectOption("selection");
  await page.locator("#importDataInput").setInputFiles({ name: "large.json", mimeType: "application/json", buffer: Buffer.alloc(5_000_001, 32) });
  await expect(page.locator("#backupStatus")).toContainText("超过 5 MB");
  await page.waitForTimeout(2800);
  await expect(page.locator("#backupStatus")).toContainText("超过 5 MB");
  await expect(page.locator("#learningStatus")).toBeEmpty();
  await expect(page.locator("#translatorStatus")).toBeEmpty();
  await expect(page.locator("#providerModel")).toHaveValue("unsaved");
  await capture(page, "04-scoped-backup-error");
});

test("all language titles keep LexiGlow and Arabic controls have direction and accessible names", async ({ context, extensionWorker, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  const languages = await page.locator("#learnerLanguageCode option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  for (const language of languages) {
    await page.locator("#learnerLanguageCode").selectOption(language);
    await page.locator("#saveTranslatorButton").click();
    await expect(page.locator("h1")).toContainText("LexiGlow");
    await expect(page.locator("#saveTranslatorButton")).toBeEnabled();
  }
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("#llmDisplayMode")).toHaveAccessibleName("عرض الترجمة");
  await expect(page.locator("#newProfileButton")).toHaveText("جديد");
  await expect(page.locator("#providerBaseUrl")).toHaveAttribute("dir", "ltr");
  await capture(page, "05-arabic-settings");
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/dist/popup.html`);
  await expect(popup.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(popup, "06-arabic-popup");
});

test("automatic highlighting respects language regions and Unicode boundaries, including dynamic language changes", async ({ context, page, extensionWorker }) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context);
  await serveTestPage(context, page, '<main lang="fr"><p id="foreign">Bonjour circumlocution café naïve café</p><p lang="en" id="english">English obfuscation don’t mixed-precision</p></main><p id="unicode">café naïve café 中work文</p>');
  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(true);
  const texts = await getHighlightTexts(page);
  expect(texts).not.toContain("circumlocution");
  for (const fragment of ["caf", "na", "ve", "cafe", "work"]) expect(texts).not.toContain(fragment);
  await page.locator("#foreign").hover();
  await expect(page.locator(".wordwise-card")).not.toBeVisible();
  await page.locator("main").evaluate((element) => element.setAttribute("lang", "en"));
  await expect.poll(async () => (await getHighlightTexts(page)).includes("circumlocution")).toBe(true);
  await page.locator("main").evaluate((element) => element.setAttribute("lang", "fr"));
  await expect.poll(async () => (await getHighlightTexts(page)).includes("circumlocution")).toBe(false);
  await capture(page, "07-language-regions");
});

for (const selection of [false, true]) {
  test(`${selection ? "selection" : "hover"} shows safe auth/fallback notices and clears them on successful retry`, async ({ context, page, extensionWorker }) => {
    await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
    await seedTranslatorSettings(extensionWorker, { defaultTranslationProvider: "llm", fallbackToGoogle: false });
    let status = 401;
    await context.route("http://llm.test/**", (route) => route.fulfill({ status, contentType: "application/json", body: status === 200 ? openAiResponse(selection ? { word: "成功" } : { word: "成功", pos: "noun", hint: "测试" }) : JSON.stringify({ error: "SYNTHETIC_SECRET_MUST_NOT_BE_SHOWN" }) }));
    await mockGoogleTranslation(context, "Google mock 回退");
    await serveTestPage(context, page, selection ? '<p id="target">This synthetic sentence tests contextual translation.</p>' : '<p>We test <span id="target">obfuscation</span> carefully.</p>');
    if (selection) await selectElementText(page, "#target"); else await page.locator("#target").hover();
    await expect(page.locator(".wordwise-primary-translation")).toContainText("401/403");
    await expect(page.locator(".wordwise-card")).not.toContainText("SYNTHETIC_SECRET");
    status = 429;
    await seedTranslatorSettings(extensionWorker, { defaultTranslationProvider: "llm", fallbackToGoogle: true });
    // Translator changes intentionally close the old tooltip. Reopen it with the
    // new settings rather than clicking a control belonging to a stale session.
    await page.waitForTimeout(150);
    if (selection) await selectElementText(page, "#target");
    else { await page.mouse.move(0, 0); await page.locator("#target").hover(); }
    await expect(page.locator(".wordwise-feedback").filter({ hasText: "已改用 Google" })).toBeVisible();
    await capture(page, selection ? "09-selection-fallback" : "08-hover-fallback");
    status = 200;
    await page.getByRole("button", { name: "语境翻译", exact: true }).click();
    await expect(page.locator(".wordwise-primary-translation")).toContainText("成功");
    await expect(page.locator(".wordwise-feedback").filter({ hasText: "已改用 Google" })).not.toBeVisible();
  });
}

test("missing-key fallback is explicit and ambiguous pronunciation explains a safe next step across contexts", async ({ context, page, extensionWorker }) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, { llmProvider: "openai", providerBaseUrl: "https://api.openai.com/v1", defaultTranslationProvider: "llm", fallbackToGoogle: true, apiKey: "" });
  await mockGoogleTranslation(context, "Google mock");
  await serveTestPage(context, page, '<p>I <span id="present">read</span> reports every day.</p><p>I <span id="past">read</span> this book yesterday.</p><p id="sentence">This is a full synthetic sentence.</p>');
  await selectElementText(page, "#present");
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "API Key" })).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation-ipa").first()).toContainText("多种发音");
  await expect(page.getByLabel("播放美式发音")).toBeDisabled();
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "更完整的句子" })).toBeVisible();
  await capture(page, "10-pronunciation-guidance");
  await selectElementText(page, "#sentence");
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "更完整的句子" })).not.toBeVisible();
  await selectElementText(page, "#past");
  await expect(page.locator(".wordwise-pronunciation-ipa").first()).toContainText("red");
  await expect(page.getByLabel("播放美式发音")).toBeEnabled();
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "更完整的句子" })).not.toBeVisible();
});

test("failed import publication preserves public data and actual private keys, then succeeds on retry", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await page.locator("#providerApiKey").fill("synthetic-rollback-key");
  await page.locator("#saveTranslatorButton").click();
  await expect(page.locator("#providerApiKey")).toBeEnabled();
  const before = await backup(page);
  const imported = structuredClone(before);
  imported.userSettings.knownBaseRank = 4200;
  imported.translatorSettingsState.profiles[0].providerBaseUrl = "http://changed.test/v1";
  await page.evaluate(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    let failOnce = true;
    chrome.storage.local.set = (async (items: Record<string, unknown>) => {
      if (failOnce && items.userSettings && items.translatorSettings) {
        failOnce = false;
        throw new Error("Synthetic storage publication failure");
      }
      return original(items);
    }) as typeof chrome.storage.local.set;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await importPayload(page, imported);
  await expect(page.locator("#backupStatus")).toContainText("导入失败");
  expect(await backup(page)).toEqual(before);
  await page.reload();
  await expect(page.locator("#providerApiKey")).toHaveValue("synthetic-rollback-key");
  await expect(page.locator("#rankNumber")).toHaveValue("2500");
  page.once("dialog", (dialog) => dialog.accept());
  await importPayload(page, imported);
  await expect(page.locator("#backupStatus")).toContainText("已导入");
  await expect(page.locator("#rankNumber")).toHaveValue("4200");
  await expect(page.locator("#providerApiKey")).toHaveValue("");
});

test("Google fallback failure has a safe retry message and clears on recovery", async ({ context, page, extensionWorker }) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, { defaultTranslationProvider: "llm", fallbackToGoogle: true });
  await context.route("http://llm.test/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{" }));
  let googleFails = true;
  await context.route("https://translate.googleapis.com/**", (route) => googleFails ? route.abort() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([[["Recovered mock Google"]]]) }));
  await serveTestPage(context, page, '<p id="target">This synthetic sentence tests network recovery.</p>');
  await selectElementText(page, "#target");
  await expect(page.locator(".wordwise-primary-translation")).toContainText("检查网络");
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "已改用 Google" })).not.toBeVisible();
  googleFails = false;
  await page.getByRole("button", { name: "Google", exact: true }).click();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("Recovered mock Google");
  await expect(page.locator(".wordwise-feedback").filter({ hasText: "已改用 Google" })).not.toBeVisible();
});
