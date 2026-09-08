import type { BrowserContext, Request } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  getHighlightCount,
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

test("hover translation can be marked Known and survives a page reload", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "混淆");
  await serveTestPage(
    context,
    page,
    '<p>We study <span id="target">obfuscation</span> carefully.</p>',
  );

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation"))
    .toBe(true);

  await page.locator("#target").hover();
  await expect(page.locator(".wordwise-primary-translation")).toContainText("混淆");
  await page.getByRole("button", { name: "已掌握", exact: true }).click();

  await expect.poll(async () => (await getHighlightTexts(page)).includes("obfuscation"))
    .toBe(false);

  const saved = await readUserSettings(extensionWorker);
  expect(saved?.masteredOverrides).toEqual(expect.arrayContaining(["obfuscation"]));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  expect(await getHighlightTexts(page)).not.toContain("obfuscation");
});

test("double-clicking a known word can put it back into spaced relearning", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 10_000 });
  await mockGoogleTranslation(context, "工作");
  await serveTestPage(context, page, '<p>Please <span id="known">work</span> carefully.</p>');

  await page.waitForTimeout(300);
  expect(await getHighlightTexts(page)).not.toContain("work");

  await page.locator("#known").dblclick();
  await expect(page.getByRole("button", { name: "继续学习", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续学习", exact: true }).click();

  await expect.poll(async () => (await getHighlightTexts(page)).includes("work")).toBe(true);

  const saved = await readUserSettings(extensionWorker);
  const progress = saved?.learningProgress as Record<string, { status?: string }> | undefined;
  expect(saved?.unmasteredOverrides).toEqual(expect.arrayContaining(["work"]));
  expect(progress?.work?.status).toBe("learning");
});

test("changing the vocabulary threshold in the popup updates the active page", async ({
  context,
  page,
  extensionId,
}) => {
  await serveTestPage(context, page, '<p>The team will <span id="word">work</span> today.</p>');
  await page.waitForTimeout(300);
  expect(await getHighlightTexts(page)).not.toContain("work");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/dist/popup.html`);
  await popup.locator("#rankNumber").fill("0");
  await popup.locator("#rankNumber").dispatchEvent("change");

  await expect.poll(async () => (await getHighlightTexts(page)).includes("work")).toBe(true);
  await popup.close();
});

test("long selection keeps the full source and supports a keyless local LLM", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "llm",
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });

  const selected = `${"This selected source must remain complete because its later context matters. ".repeat(8)}TAIL_MARKER`;
  let capturedPrompt = "";
  let capturedRequest: Request | null = null;

  await context.route("http://llm.test/**", async (route) => {
    capturedRequest = route.request();
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      messages?: Array<{ role: string; content: string }>;
    };
    capturedPrompt = body.messages?.at(-1)?.content ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse({ word: "完整译文" }),
    });
  });

  await serveTestPage(context, page, `<p id="selection">${selected}</p>`);
  await selectElementText(page, "#selection");

  await expect(page.locator(".wordwise-primary-translation")).toContainText("完整译文");
  expect(capturedPrompt).toContain("TAIL_MARKER");
  expect(capturedPrompt.indexOf("TAIL_MARKER")).toBeGreaterThan(220);
  expect(capturedRequest?.headers()["authorization"]).toBeUndefined();
});

test("sentence analysis retries incomplete structure and highlights the intended repeated token", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedTranslatorSettings(extensionWorker, {
    defaultTranslationProvider: "google",
    providerBaseUrl: "http://llm.test/v1",
    apiKey: "",
  });
  await mockGoogleTranslation(context, "快速译文");

  const sentence =
    "I think that the model that we tested shows that careful analysis matters because readers rely on structure.";
  const first = {
    translation: "第一次残缺译文。",
    structure: "I think",
    analysisSteps: ["切分。", "找主干。", "看修饰。", "安排译序。"],
    highlights: [{ category: "predicate", text: "think", tokenIndex: 1 }],
    clauseBlocks: ["main|||I think"],
  };
  const second = {
    translation: "第二次完整译文。",
    structure: "I think; model shows; analysis matters",
    analysisSteps: [
      "先切出主句和 because 从句。",
      "主干包含 think、shows 和 matters。",
      "第二个 that 引导修饰 model 的关系从句。",
      "先译主干，再补关系从句和原因从句。",
    ],
    highlights: [
      { category: "subject", text: "I", tokenIndex: 0 },
      { category: "predicate", text: "shows", tokenIndex: 8 },
      { category: "relative", text: "that", tokenIndex: 5 },
      { category: "conjunction", text: "because", tokenIndex: 13 },
    ],
    clauseBlocks: [
      "main|||I think that the model that we tested shows that careful analysis matters",
      "subordinate|||because readers rely on structure.",
    ],
  };

  let analysisCalls = 0;
  const prompts: string[] = [];
  await context.route("http://llm.test/**", async (route) => {
    analysisCalls += 1;
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      messages?: Array<{ role: string; content: string }>;
    };
    prompts.push(body.messages?.at(-1)?.content ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse(analysisCalls === 1 ? first : second),
    });
  });

  await serveTestPage(context, page, `<p id="sentence">${sentence}</p>`);
  await selectElementText(page, "#sentence");
  await expect(page.locator(".wordwise-primary-translation")).toContainText("快速译文");

  await page.getByRole("button", { name: "长难句分析", exact: true }).click();
  await expect(page.getByText("第二次完整译文。", { exact: true })).toBeVisible();

  expect(analysisCalls).toBe(2);
  expect(prompts[1]).toContain("quality_retry:");
  expect(prompts[1]).toContain("5:that");

  const thatCountBeforeMark = await page.locator(".wordwise-analysis-source").evaluate((source) => {
    const mark = source.querySelector(".wordwise-mark--relative");
    if (!mark) {
      return -1;
    }
    const range = document.createRange();
    range.selectNodeContents(source);
    range.setEndBefore(mark);
    return range.toString().match(/\bthat\b/gi)?.length ?? 0;
  });
  expect(thatCountBeforeMark).toBe(1);
});

test("large dynamic pages only materialize nearby highlights and process new viewport content", async ({
  context,
  page,
  extensionWorker,
}) => {
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });

  const rows = Array.from({ length: 1200 }, (_, index) => {
    if (index === 1199) {
      return '<p class="row"><span id="bottom">conflagration</span></p>';
    }
    return `<p class="row">obfuscation row ${index}</p>`;
  }).join("");

  await serveTestPage(
    context,
    page,
    `<main id="feed">${rows}</main>`,
    ".row { margin: 0; height: 36px; }",
  );

  await expect.poll(async () => await getHighlightCount(page)).toBeGreaterThan(0);
  expect(await getHighlightCount(page)).toBeLessThan(100);
  expect(await getHighlightTexts(page)).not.toContain("conflagration");

  await page.locator("#bottom").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await getHighlightTexts(page)).includes("conflagration"))
    .toBe(true);

  await page.locator("#feed").evaluate((feed) => {
    const row = document.createElement("p");
    row.className = "row";
    row.id = "dynamic";
    row.textContent = "circumlocution";
    feed.append(row);
    row.scrollIntoView({ block: "center" });
  });

  await expect.poll(async () => (await getHighlightTexts(page)).includes("circumlocution"))
    .toBe(true);
});
