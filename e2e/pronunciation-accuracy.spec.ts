import { expect, test } from "./fixtures";
import {
  clearExtensionStorage,
  mockGoogleTranslation,
  seedUserSettings,
  selectElementText,
  serveTestPage,
} from "./helpers";

function silentWav(): Buffer {
  const sampleRate = 8000;
  const samples = 400;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function routePronunciation(context: Parameters<typeof test>[0] extends never ? never : any, word: string, withAudio = false) {
  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route: any) => {
    const audio = withAudio ? { "audio-ipa": "/ˌɑːbfəsˈkeɪʃən/", mp3_url: "https://audio.test/obfuscation-us.wav" } : {};
    await route.fulfill({
      status: 200,
      contentType: "application/jsonl",
      body: JSON.stringify({ word, pos: "noun", sounds: [
        { tags: ["UK"], ipa: "/ˌɒbfʌsˈkeɪʃən/" },
        { tags: ["US"], ipa: "/ˌɑːbfəsˈkeɪʃən/", ...audio },
      ] }),
    });
  });
}

test.beforeEach(async ({ extensionWorker }) => {
  await clearExtensionStorage(extensionWorker);
  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });
});

test("single-word selection shows raw UK/US IPA", async ({ context, page }) => {
  await mockGoogleTranslation(context, "混淆");
  await routePronunciation(context, "obfuscation");
  await serveTestPage(context, page, '<p>I study <span id="target">obfuscation</span> carefully.</p>');
  await selectElementText(page, "#target");
  await expect(page.locator(".wordwise-pronunciation")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).toContainText("/ˌɒbfʌsˈkeɪʃən/");
  await expect(page.locator(".wordwise-pronunciation")).toContainText("/ˌɑːbfəsˈkeɪʃən/");
  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("keiʃən");
});

test("dictionary human audio is played before Chrome TTS", async ({ context, page, extensionWorker }) => {
  await mockGoogleTranslation(context, "混淆");
  await routePronunciation(context, "obfuscation", true);
  let audioRequested = false;
  await context.route("https://audio.test/obfuscation-us.wav", async (route) => {
    audioRequested = true;
    await route.fulfill({ status: 200, contentType: "audio/wav", body: silentWav() });
  });
  await extensionWorker.evaluate(() => {
    const state = globalThis as typeof globalThis & { __pronunciationSpeakMessages?: unknown[] };
    state.__pronunciationSpeakMessages = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "SPEAK_PRONUNCIATION") state.__pronunciationSpeakMessages?.push(message);
    });
  });
  await serveTestPage(context, page, '<p>I study <span id="target">obfuscation</span> carefully.</p>');
  await selectElementText(page, "#target");
  await expect(page.getByLabel("播放美式发音")).toBeVisible();
  await page.getByLabel("播放美式发音").click();
  await expect.poll(() => audioRequested).toBe(true);
  await page.waitForTimeout(250);
  expect(await extensionWorker.evaluate(() => (globalThis as any).__pronunciationSpeakMessages?.length ?? 0)).toBe(0);
});

test("TTS receives the exact selected surface when no human audio exists", async ({ context, page, extensionWorker }) => {
  await mockGoogleTranslation(context, "混淆");
  await routePronunciation(context, "obfuscation", false);
  await extensionWorker.evaluate(() => {
    const state = globalThis as typeof globalThis & { __pronunciationSpeakMessages?: Array<{ payload?: { text?: string; accent?: string } }> };
    state.__pronunciationSpeakMessages = [];
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "SPEAK_PRONUNCIATION") state.__pronunciationSpeakMessages?.push(message);
    });
  });
  await serveTestPage(context, page, '<p>I study <span id="target">obfuscation</span> carefully.</p>');
  await selectElementText(page, "#target");
  await page.getByLabel("播放美式发音").click();
  await expect.poll(async () => extensionWorker.evaluate(() => (globalThis as any).__pronunciationSpeakMessages?.at(-1)?.payload ?? null))
    .toEqual(expect.objectContaining({ text: "obfuscation", accent: "en-US" }));
});

test("context resolves refuse as a verb for selected text", async ({ context, page }) => {
  await mockGoogleTranslation(context, "拒绝");
  await context.route("https://kaikki.org/dictionary/English/meaning/**", (route) => route.fulfill({ status: 404, body: "" }));
  await serveTestPage(context, page, '<p>I <span id="target">refuse</span> the offer.</p>');
  await selectElementText(page, "#target");
  await expect(page.locator(".wordwise-pronunciation")).toContainText("/rɪˈfjuːz/");
});

test("multi-word selection keeps pronunciation controls hidden", async ({ context, page }) => {
  await mockGoogleTranslation(context, "考虑");
  await serveTestPage(context, page, '<p><span id="target">take into account</span> the evidence.</p>');
  await selectElementText(page, "#target");
  await expect(page.locator(".wordwise-primary-translation")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).toBeHidden();
});
