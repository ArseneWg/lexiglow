import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { clearExtensionStorage, mockGoogleTranslation, seedUserSettings } from "../helpers";

async function selectWord(page: Page, word: string): Promise<boolean> {
  return page.evaluate((target) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pattern = new RegExp("\\b" + target + "\\b", "i");
    let node = walker.nextNode() as Text | null;
    while (node) {
      const parent = node.parentElement;
      const match = parent && !parent.closest("script, style, noscript, code, pre")
        ? (node.textContent || "").match(pattern)
        : null;
      if (match && match.index !== undefined && parent) {
        const style = getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || parentRect.width <= 0 || parentRect.height <= 0) {
          node = walker.nextNode() as Text | null;
          continue;
        }
        parent.scrollIntoView({ block: "center" });
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        const rect = range.getBoundingClientRect();
        parent.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }));
        return true;
      }
      node = walker.nextNode() as Text | null;
    }
    return false;
  }, word);
}

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "预测");
});

test("web.dev default Google card visibly enriches predictions and keeps offline IPA", async ({ context, page }) => {
  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/predictions.jsonl")) {
      await route.fulfill({ status: 200, contentType: "application/jsonl", body: JSON.stringify({
        word: "predictions", pos: "noun", senses: [{ tags: ["form-of"], form_of: [{ word: "prediction" }], glosses: ["plural of prediction"] }],
      }) });
      return;
    }
    if (url.endsWith("/prediction.jsonl")) {
      await route.fulfill({ status: 200, contentType: "application/jsonl", body: JSON.stringify({
        word: "prediction", pos: "noun", senses: [
          { glosses: ["A statement about what will happen in the future."], translations: [{ lang_code: "cmn", word: "预测" }, { lang_code: "cmn", word: "预言" }] },
          { glosses: ["A forecast produced by a statistical or machine-learning model."], translations: [{ lang_code: "cmn", word: "预测结果" }] },
        ],
      }) });
      return;
    }
    await route.fulfill({ status: 503, body: "" });
  });
  const response = await page.goto("https://web.dev/articles/prerender-pages", { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response?.status() ?? 200).toBeLessThan(400);
  await page.waitForTimeout(600);
  expect(await selectWord(page, "predictions")).toBe(true);
  await expect(page.locator(".wordwise-primary-translation")).toContainText("预测");
  await expect(page.locator(".wordwise-word-form")).toContainText("prediction · plural", { timeout: 5_000 });
  await expect(page.locator(".wordwise-semantic-hint")).toContainText("statement", { timeout: 5_000 });
  await expect(page.locator(".wordwise-other-meanings")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA", { timeout: 5_000 });
});
