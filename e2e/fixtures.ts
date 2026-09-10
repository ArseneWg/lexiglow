import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

interface ExtensionFixtures {
  context: BrowserContext;
  page: Page;
  extensionWorker: Worker;
  extensionId: string;
  extensionPath: string;
  userDataDir: string;
}

export async function launchExtensionContext(
  userDataDir: string,
  extensionPath: string,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

export const test = base.extend<ExtensionFixtures>({
  extensionPath: async ({}, use) => {
    const configuredPath = process.env.LEXIGLOW_EXTENSION_PATH?.trim();
    await use(configuredPath ? path.resolve(configuredPath) : path.resolve(process.cwd()));
  },

  userDataDir: async ({}, use) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lexiglow-e2e-"));
    await use(directory);
    await rm(directory, { recursive: true, force: true });
  },

  context: async ({ extensionPath, userDataDir }, use) => {
    const context = await launchExtensionContext(userDataDir, extensionPath);
    await use(context);
    await context.close().catch(() => {});
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? await context.newPage();
    await use(page);
  },

  extensionWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent("serviceworker");
    }
    await use(worker);
  },

  extensionId: async ({ extensionWorker }, use) => {
    await use(new URL(extensionWorker.url()).host);
  },
});

export { expect };
