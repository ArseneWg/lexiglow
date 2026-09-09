import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { clearExtensionStorage, mockGoogleTranslation, seedUserSettings } from "../helpers";

async function selectFirstWord(page: Page, word: string): Promise<boolean> {
  return page.evaluate((target) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const re = new RegExp("\\b" + target + "\\b", "i");
    let node = walker.nextNode() as Text | null;
    while (node) {
      const parent = node.parentElement;
      const match = !parent?.closest("script, style, code, pre") ? (node.textContent || "").match(re) : null;
      if (match && match.index !== undefined && parent) {
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

test("React real page resolves live structured pronunciation data", async ({ context, page, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "组件");
  const response = await page.goto("https://react.dev/learn/your-first-component", { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response?.status() ?? 200).toBeLessThan(400);
  await page.waitForTimeout(600);
  expect(await selectFirstWord(page, "component")).toBe(true);
  await expect(page.locator(".wordwise-pronunciation")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA", { timeout: 12_000 });
});
