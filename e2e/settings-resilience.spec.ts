import { expect, launchExtensionContext, test } from "./fixtures";
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

test("Options can switch single-word review from double-click to selection", async ({
  context,
  page,
  extensionWorker,
  extensionId,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 10_000 });
  await mockGoogleTranslation(context, "工作");
  await serveTestPage(context, page, '<p>Please <span id="known">work</span> carefully.</p>');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await options.locator("#wordReviewTrigger").selectOption("selection");
  await expect.poll(async () => (await readUserSettings(extensionWorker))?.wordReviewTrigger).toBe("selection");
  await options.close();

  await selectElementText(page, "#known");
  await expect(page.getByRole("button", { name: "继续学习", exact: true })).toBeVisible();
});

test("Options translator settings immediately drive the active page provider and learner language", async ({
  context,
  page,
  extensionWorker,
  extensionId,
}) => {
  await serveTestPage(
    context,
    page,
    '<p id="selection">Context changes how this phrase should be translated.</p>',
  );

  let capturedPayload = "";
  await context.route("http://llm.test/**", async (route) => {
    capturedPayload = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "設定後の翻訳" }),
    });
  });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/dist/options.html`);
  await options.locator("#learnerLanguageCode").selectOption("ja");
  await options.locator("#defaultTranslationProvider").selectOption("llm");
  await options.locator("#llmProvider").selectOption("openai");
  await options.locator("#providerBaseUrl").fill("http://llm.test/v1");
  await options.locator("#providerModel").fill("e2e-options-model");
  await options.locator("#providerApiKey").fill("");
  await options.locator("#fallbackToGoogle").uncheck();
  await options.locator("#saveTranslatorButton").click();
  await expect(options.locator("#saveTranslatorButton")).toBeEnabled();

  const stored = await extensionWorker.evaluate(async () => {
    const result = await chrome.storage.local.get("translatorSettings");
    return result.translatorSettings as {
      activeProfileId?: string;
      profiles?: Array<Record<string, unknown>>;
    } | undefined;
  });
  const active = stored?.profiles?.find((profile) => profile.id === stored.activeProfileId);
  expect(active).toEqual(expect.objectContaining({
    learnerLanguageCode: "ja",
    defaultTranslationProvider: "llm",
    providerBaseUrl: "http://llm.test/v1",
    providerModel: "e2e-options-model",
  }));
  await options.close();

  await page.waitForTimeout(200);
  await selectElementText(page, "#selection");
  await expect(page.locator(".wordwise-primary-translation")).toContainText("設定後の翻訳");
  expect(capturedPayload).toContain("Japanese (ja)");
});

test("pronunciation controls render accent data and dispatch the requested US speech action", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "混淆");

  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/jsonl",
      body: JSON.stringify({
        word: "obfuscation",
        pos: "noun",
        sounds: [
          { tags: ["UK"], ipa: "/ˌɒbfʌsˈkeɪʃən/" },
          { tags: ["US"], ipa: "/ˌɑːbfəsˈkeɪʃən/" },
        ],
      }),
    });
  });

  await extensionWorker.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __lexiGlowSpeakMessages?: Array<{ text?: string; accent?: string }>;
    };
    state.__lexiGlowSpeakMessages = [];
    chrome.runtime.onMessage.addListener((message: { type?: string; payload?: { text?: string; accent?: string } }) => {
      if (message.type === "SPEAK_PRONUNCIATION") {
        state.__lexiGlowSpeakMessages?.push(message.payload ?? {});
      }
    });
  });

  await serveTestPage(context, page, '<p>We study <span id="target">obfuscation</span> carefully.</p>');
  await page.locator("#target").hover();

  await expect(page.getByLabel("播放英式发音")).toBeVisible();
  await expect(page.getByLabel("播放美式发音")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).toContainText("/ˌɒbfʌsˈkeɪʃən/");

  await page.getByLabel("播放美式发音").click();
  await expect.poll(async () => {
    return extensionWorker.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __lexiGlowSpeakMessages?: Array<{ text?: string; accent?: string }>;
      };
      return state.__lexiGlowSpeakMessages?.at(-1) ?? null;
    });
  }).toEqual(expect.objectContaining({ text: "obfuscation", accent: "en-US" }));
});

test("restarting the same Chromium profile preserves learning state and restores content behavior", async ({
  context,
  page,
  extensionWorker,
  extensionPath,
  userDataDir,
}) => {
  await seedUserSettings(extensionWorker, {
    knownBaseRank: 0,
    masteredOverrides: ["obfuscation"],
    learningProgress: {
      obfuscation: {
        status: "known",
        familiarity: 1,
        exposures: 1,
        successes: 1,
      },
    },
  });
  await serveTestPage(context, page, '<p id="text">obfuscation should stay mastered after restart.</p>');
  await page.waitForTimeout(250);
  expect(await getHighlightTexts(page)).not.toContain("obfuscation");

  await context.close();

  const restartedContext = await launchExtensionContext(userDataDir, extensionPath);
  try {
    await mockDictionaryFailures(restartedContext);
    let [restartedWorker] = restartedContext.serviceWorkers();
    if (!restartedWorker) {
      restartedWorker = await restartedContext.waitForEvent("serviceworker");
    }

    const settings = await readUserSettings(restartedWorker);
    expect(settings?.masteredOverrides).toEqual(expect.arrayContaining(["obfuscation"]));

    const restartedPage = restartedContext.pages()[0] ?? await restartedContext.newPage();
    await serveTestPage(
      restartedContext,
      restartedPage,
      '<p id="text">obfuscation should stay mastered after restart.</p>',
    );
    await restartedPage.waitForTimeout(300);
    expect(await getHighlightTexts(restartedPage)).not.toContain("obfuscation");
  } finally {
    await restartedContext.close();
  }
});

test("context extraction reconstructs a sentence split across inline DOM nodes", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });

  let capturedPrompt = "";
  await context.route("http://llm.test/**", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      messages?: Array<{ role: string; content: string }>;
    };
    capturedPrompt = body.messages?.at(-1)?.content ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "继续", pos: "verb" }),
    });
  });

  await serveTestPage(
    context,
    page,
    '<article><p>Although <a href="#">the experiment</a> failed, <strong>the team</strong> still decided to <span id="target">continue</span>.</p></article>',
  );
  await page.locator("#target").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("继续");

  expect(capturedPrompt).toContain("Although the experiment failed, the team still decided to continue.");
});

test("SPA-style subtree replacement removes stale highlights and discovers the new route content", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await serveTestPage(
    context,
    page,
    '<main id="app"><article><p id="old">obfuscation on the initial route.</p></article></main>',
  );

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(true);

  await page.locator("#app").evaluate((app) => {
    history.pushState({}, "", "/next-route");
    app.innerHTML = '<article><h1>Next route</h1><p id="next">circumlocution appears after client-side navigation.</p></article>';
  });

  await expect.poll(async () => (await getHighlightTexts(page)).includes("circumlocution")).toBe(true);
  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation")).toBe(false);
});
