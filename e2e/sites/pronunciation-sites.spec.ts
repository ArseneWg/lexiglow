import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { clearExtensionStorage, mockGoogleTranslation, seedUserSettings } from "../helpers";

async function selectWord(page: Page, word: string): Promise<boolean> {
  return page.evaluate((target) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    const pattern = new RegExp("\\b" + target + "\\b", "i");
    while (node) {
      const parent = node.parentElement;
      if (parent && !parent.closest("script, style, noscript, input, textarea, select, option, code, pre")) {
        const match = (node.textContent || "").match(pattern);
        if (match && match.index !== undefined) {
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
      }
      node = walker.nextNode() as Text | null;
    }
    return false;
  }, word);
}

async function load(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response?.status() ?? 200).toBeLessThan(400);
  await page.waitForTimeout(600);
}

async function routeDeterministicPronunciation(context: any) {
  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route: any) => {
    const url = new URL(route.request().url());
    const word = decodeURIComponent(url.pathname.split("/").at(-1)?.replace(/\.jsonl$/, "") || "word");
    await route.fulfill({
      status: 200,
      contentType: "application/jsonl",
      body: JSON.stringify({ word, pos: "noun", sounds: [
        { tags: ["UK"], ipa: "/tɛst/" },
        { tags: ["US"], ipa: "/tɛst/" },
      ] }),
    });
  });
}

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockGoogleTranslation(context, "真实站点发音测试");
  await routeDeterministicPronunciation(context);
});

const sites = [
  { name: "GitHub", url: "https://github.com/ArseneWg/lexiglow", word: "extension" },
  { name: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction", word: "JavaScript" },
  { name: "web.dev", url: "https://web.dev/articles/rendering-on-the-web", word: "rendering" },
  { name: "React", url: "https://react.dev/learn/your-first-component", word: "component" },
] as const;

for (const site of sites) {
  test(site.name + " supports exact single-word selection pronunciation", async ({ page }) => {
    await load(page, site.url);
    expect(await selectWord(page, site.word)).toBe(true);
    await expect(page.locator(".wordwise-pronunciation")).toBeVisible();
    await expect(page.locator(".wordwise-pronunciation")).toContainText("/tɛst/");
  });
}
