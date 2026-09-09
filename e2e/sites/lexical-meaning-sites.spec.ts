import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import {
  clearExtensionStorage,
  openAiResponse,
  seedTranslatorSettings,
  seedUserSettings,
} from "../helpers";

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
        const rect = parent.getBoundingClientRect();
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0;

        if (visible && match && match.index !== undefined) {
          parent.scrollIntoView({ block: "center", inline: "nearest" });
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rangeRect = range.getBoundingClientRect();
          if (rangeRect.width <= 0 || rangeRect.height <= 0) {
            node = walker.nextNode() as Text | null;
            continue;
          }
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          document.dispatchEvent(new MouseEvent("mouseup", {
            bubbles: true,
            clientX: rangeRect.left + Math.min(4, rangeRect.width / 2),
            clientY: rangeRect.top + Math.min(4, rangeRect.height / 2),
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

async function seedContextualLlm(extensionWorker: any) {
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
}

const sites = [
  { name: "GitHub", url: "https://github.com/ArseneWg/lexiglow", word: "extension", scope: "body" },
  { name: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction", word: "JavaScript", scope: "body" },
  { name: "web.dev", url: "https://web.dev/articles/rendering-on-the-web", word: "developers", scope: "article" },
  { name: "React", url: "https://react.dev/learn/your-first-component", word: "component", scope: "body" },
] as const;

for (const site of sites) {
  test(site.name + " renders contextual lexical meaning on a real page", async ({ context, page, extensionWorker }) => {
    await seedContextualLlm(extensionWorker);
    await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {
      const url = new URL(route.request().url());
      const word = decodeURIComponent(url.pathname.split("/").at(-1)?.replace(/\.jsonl$/, "") || site.word);
      await route.fulfill({
        status: 200,
        contentType: "application/jsonl",
        body: JSON.stringify({
          word,
          pos: "noun",
          senses: [
            { glosses: ["a part or element used within a larger system"] },
            { glosses: ["a constituent part of a whole"] },
          ],
          sounds: [
            { tags: ["UK"], ipa: "/tɛst/" },
            { tags: ["US"], ipa: "/tɛst/" },
          ],
        }),
      });
    });
    await context.route("http://llm.test/v1/chat/completions", async (route) => {
      const payload = route.request().postDataJSON() as unknown;
      expect(JSON.stringify(payload)).toContain("dictionary_senses");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: openAiResponse(JSON.stringify({
          word: "语境义",
          pos: "noun",
          hint: "当前网页语境中的具体含义",
          alternatives: [
            { meaning: "其他常见义", hint: "另一种常见使用场景", pos: "noun" },
          ],
        })),
      });
    });

    await load(page, site.url);
    expect(await selectWord(page, site.word, site.scope)).toBe(true);
    await expect(page.locator(".wordwise-primary-translation")).toContainText("语境义", { timeout: 12_000 });
    await expect(page.locator(".wordwise-semantic-hint")).toContainText("当前网页语境中的具体含义");
    await expect(page.locator(".wordwise-other-meanings")).toBeVisible();
  });
}

test("React real page sends live Kaikki senses into contextual meaning resolution", async ({ context, page, extensionWorker }) => {
  await seedContextualLlm(extensionWorker);
  let prompt = "";
  await context.route("http://llm.test/v1/chat/completions", async (route) => {
    const payload = route.request().postDataJSON() as { messages?: Array<{ content?: string }> };
    prompt = payload.messages?.map((message) => message.content || "").join("\n") || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: openAiResponse(JSON.stringify({
        word: "组件",
        pos: "noun",
        hint: "构成更大系统的一个部分",
        alternatives: [],
      })),
    });
  });

  await load(page, "https://react.dev/learn/your-first-component");
  expect(await selectWord(page, "component", "body")).toBe(true);
  await expect(page.locator(".wordwise-primary-translation")).toContainText("组件", { timeout: 15_000 });
  expect(prompt).toContain("dictionary_senses:");
  expect(prompt).not.toContain("dictionary_senses:\n(no structured dictionary senses available)");
});
