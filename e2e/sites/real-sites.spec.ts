import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../fixtures";
import {
  clearExtensionStorage,
  getHighlightCount,
  mockDictionaryFailures,
  mockGoogleTranslation,
  seedUserSettings,
} from "../helpers";

const MAX_HIGHLIGHT_RANGES = 1800;
const BLOCKED_PAGE_PATTERN =
  /(?:access denied|too many requests|whoa there|you(?:'|’)ve been blocked|blocked by network security|security check|robot or human|verify you are human|captcha)/i;

interface SiteLoadResult {
  url: string;
  status: number;
  bodyText: string;
}

async function loadPublicSite(page: Page, url: string): Promise<SiteLoadResult> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  return {
    url: page.url(),
    status: response?.status() ?? 0,
    bodyText: await page.locator("body").innerText({ timeout: 10_000 }).catch(() => ""),
  };
}

function isExternallyBlocked(result: SiteLoadResult): boolean {
  return (
    result.status === 403 ||
    result.status === 429 ||
    result.status >= 500 ||
    BLOCKED_PAGE_PATTERN.test(result.bodyText.slice(0, 5000))
  );
}

function expectHealthyPublicPage(result: SiteLoadResult) {
  expect(result.status === 0 || result.status < 400).toBe(true);
  expect(result.bodyText.length).toBeGreaterThan(200);
}

async function waitForHighlights(page: Page): Promise<number> {
  await expect.poll(
    async () => getHighlightCount(page),
    { timeout: 15_000, intervals: [250, 500, 1000] },
  ).toBeGreaterThan(0);

  const count = await getHighlightCount(page);
  expect(count).toBeLessThanOrEqual(MAX_HIGHLIGHT_RANGES);
  return count;
}

async function selectLocatorText(locator: Locator) {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new Event("selectionchange"));
    const rect = range.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
  });
}

test.beforeEach(async ({ context, extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
  await mockDictionaryFailures(context);
  await mockGoogleTranslation(context, "真实站点测试翻译");
});

test("GitHub repository pages accept the content script without breaking the document", async ({ page }) => {
  const result = await loadPublicSite(page, "https://github.com/ArseneWg/lexiglow");
  expectHealthyPublicPage(result);

  await expect(page.locator("body")).toContainText("LexiGlow");
  await waitForHighlights(page);
});

test("Hacker News supports highlighting and a real selection-translation interaction", async ({ page }) => {
  const result = await loadPublicSite(page, "https://news.ycombinator.com/");
  expectHealthyPublicPage(result);

  const titles = page.locator(".titleline a");
  await expect(titles.first()).toBeVisible();
  await waitForHighlights(page);

  let title = titles.first();
  const candidateCount = Math.min(await titles.count(), 12);
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = titles.nth(index);
    const text = (await candidate.innerText()).trim();
    if (/[A-Za-z]{4}/.test(text) && text.length >= 8 && text.length <= 300) {
      title = candidate;
      break;
    }
  }

  await selectLocatorText(title);
  await expect(page.locator(".wordwise-primary-translation")).toContainText("真实站点测试翻译");
});

test("Reddit pages smoke-test when the upstream permits CI datacenter traffic", async ({ page }) => {
  const candidates = [
    "https://old.reddit.com/r/programming/",
    "https://www.reddit.com/r/programming/",
  ];

  let accessible: SiteLoadResult | null = null;
  for (const url of candidates) {
    try {
      const result = await loadPublicSite(page, url);
      if (!isExternallyBlocked(result) && (result.status === 0 || result.status < 400)) {
        accessible = result;
        break;
      }
    } catch {
      // Try the alternate Reddit surface before deciding that CI egress is blocked.
    }
  }

  if (!accessible) {
    test.skip(true, "Reddit rejected or challenged this GitHub Actions egress IP.");
    return;
  }

  expectHealthyPublicPage(accessible);
  await waitForHighlights(page);
});

test("MDN long-form documentation incrementally materializes more highlights after scrolling", async ({ page }) => {
  const result = await loadPublicSite(
    page,
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction",
  );
  expectHealthyPublicPage(result);
  await expect(page.locator("main").first()).toBeVisible();

  const initialCount = await waitForHighlights(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect.poll(
    async () => getHighlightCount(page),
    { timeout: 15_000, intervals: [300, 600, 1000] },
  ).toBeGreaterThan(initialCount);
  expect(await getHighlightCount(page)).toBeLessThanOrEqual(MAX_HIGHLIGHT_RANGES);
});

test("web.dev article pages stay within the range budget while revealing later content", async ({ page }) => {
  const result = await loadPublicSite(page, "https://web.dev/articles/rendering-on-the-web");
  expectHealthyPublicPage(result);
  await expect(page.locator("main").first()).toBeVisible();

  const initialCount = await waitForHighlights(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect.poll(
    async () => getHighlightCount(page),
    { timeout: 15_000, intervals: [300, 600, 1000] },
  ).toBeGreaterThan(initialCount);
  expect(await getHighlightCount(page)).toBeLessThanOrEqual(MAX_HIGHLIGHT_RANGES);
});

test("React documentation client-side navigation keeps LexiGlow active across route replacement", async ({ page }) => {
  const result = await loadPublicSite(page, "https://react.dev/learn");
  expectHealthyPublicPage(result);
  await expect(page.getByRole("heading", { name: "Quick Start", exact: true }).first()).toBeVisible();
  await waitForHighlights(page);

  const installationLink = page.locator('a[href="/learn/installation"]').first();
  await expect(installationLink).toBeVisible();
  await installationLink.click();
  await page.waitForURL(/\/learn\/installation(?:[?#].*)?$/, { timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "Installation", exact: true }).first()).toBeVisible();
  await waitForHighlights(page);
});
