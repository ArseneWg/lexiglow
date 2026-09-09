import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import { clearExtensionStorage, mockGoogleTranslation, seedUserSettings } from "../helpers";

async function selectWord(page: Page, word: string, scopeSelector = "body"): Promise<boolean> {
  return page.evaluate(async ({ target, scopeSelector: selector }) => {
    const scope = document.querySelector(selector) ?? document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    const pattern = new RegExp("\\b" + target + "\\b", "i");

    while (node) {
      const parent = node.parentElement;
      if (parent && !parent.closest("script, style, noscript, input, textarea, select, option, code, pre")) {
        const match = (node.textContent || "").match(pattern);
        const style = getComputedStyle(parent);
        const parentRect = parent.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          parentRect.width > 0 &&
          parentRect.height > 0;

        if (visible && match && match.index !== undefined) {
          parent.scrollIntoView({ block: "center", inline: "nearest" });
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rect = range.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            node = walker.nextNode() as Text | null;
            continue;
          }

          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          document.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            clientX: rect.left + Math.min(4, rect.width / 2),
            clientY: rect.top + Math.min(4, rect.height / 2),
          }));
          return true;
        }
      }
      node = walker.nextNode() as Text | null;
    }
    return false;
  }, { target: word, scopeSelector });
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
  { name: "GitHub", url: "https://github.com/ArseneWg/lexiglow", word: "extension", scope: "body" },
  { name: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction", word: "JavaScript", scope: "body" },
  {
    name: "web.dev",
    url: "https://web.dev/articles/rendering-on-the-web",
    word: "developers",
    scope: "article",
  },
  { name: "React", url: "https://react.dev/learn/your-first-component", word: "component", scope: "body" },
] as const;

for (const site of sites) {
  test(site.name + " supports exact single-word selection pronunciation", async ({ page }) => {
    await load(page, site.url);
    expect(await selectWord(page, site.word, site.scope)).toBe(true);
    await expect(page.locator(".wordwise-pronunciation")).toBeVisible();
    await expect(page.locator(".wordwise-pronunciation")).toContainText("/tɛst/");
  });
}
