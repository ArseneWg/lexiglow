import { describe, expect, test, vi } from "vitest";

import {
  appendInflectionToIpa,
  deriveInflectedPronunciationVariants,
  extractKaikkiPronunciationVariants,
  getPronunciationVariantForAccent,
  resolvePronunciation,
} from "../src/shared/pronunciationResolver";
import type { PronunciationVariant } from "../src/shared/types";

function failedFetch() {
  return vi.fn(async () => ({ ok: false, text: async () => "" }));
}

describe("pronunciation resolver v2", () => {
  test("preserves source IPA instead of converting it into DJ-style symbols", () => {
    const variants = extractKaikkiPronunciationVariants(
      JSON.stringify({ word: "hello", pos: "interj", sounds: [{ tags: ["US"], ipa: "/həˈloʊ/" }] }),
      "hello",
    );
    expect(variants[0]?.ipa).toBe("/həˈloʊ/");
  });

  test("keeps audio and audio-IPA atomic on the same structured sound", () => {
    const variants = extractKaikkiPronunciationVariants(
      JSON.stringify({ word: "record", pos: "noun", sounds: [
        { tags: ["US"], ipa: "/ˈrɛkɚd/" },
        { tags: ["US"], "audio-ipa": "/rɪˈkɔrd/", mp3_url: "https://audio.test/record-verb.mp3" },
      ] }),
      "record",
    );
    expect(variants).toHaveLength(2);
    expect(variants[0]?.audio).toBeUndefined();
    expect(variants[1]?.audio?.audioIpa).toBe("/rɪˈkɔrd/");
    expect(variants[1]?.ipa).toBe("/rɪˈkɔrd/");
  });

  test("uses context to resolve refuse noun and verb readings", async () => {
    const verb = await resolvePronunciation("refuse", { contextText: "I refuse the offer.", fetchFn: failedFetch() as never });
    const noun = await resolvePronunciation("refuse", { contextText: "Please remove the refuse.", partOfSpeech: "noun", fetchFn: failedFetch() as never });
    expect(verb.confidence).toBe("context-exact");
    expect(verb.usPhonetic).toBe("/rɪˈfjuːz/");
    expect(noun.usPhonetic).toBe("/ˈrɛfjuːs/");
  });

  test("resolves read from tense-bearing context", async () => {
    const present = await resolvePronunciation("read", { contextText: "I read every morning.", fetchFn: failedFetch() as never });
    const past = await resolvePronunciation("read", { contextText: "I read it yesterday.", fetchFn: failedFetch() as never });
    expect(present.usPhonetic).toBe("/riːd/");
    expect(past.usPhonetic).toBe("/rɛd/");
  });

  test("does not guess an unresolved heteronym", async () => {
    const result = await resolvePronunciation("lead", { contextText: "lead", fetchFn: failedFetch() as never });
    expect(result.confidence).toBe("ambiguous");
    expect(result.ttsAllowed).toBe(false);
    expect(result.selectedVariantIds).toEqual({});
  });

  test("derives the three English s-ending allomorphs from the final phoneme", () => {
    expect(appendInflectionToIpa("/blɒk/", "s-ending")).toBe("/blɒks/");
    expect(appendInflectionToIpa("/dɒɡ/", "s-ending")).toBe("/dɒɡz/");
    expect(appendInflectionToIpa("/bʌs/", "s-ending")).toBe("/bʌsɪz/");
  });

  test("derives the three English ed allomorphs", () => {
    expect(appendInflectionToIpa("/lʊk/", "past-ed")).toBe("/lʊkt/");
    expect(appendInflectionToIpa("/pleɪ/", "past-ed")).toBe("/pleɪd/");
    expect(appendInflectionToIpa("/wɒnt/", "past-ed")).toBe("/wɒntɪd/");
  });

  test("derives blocks without reusing the base-word audio", () => {
    const base: PronunciationVariant[] = [
      { id: "gb", accent: "en-GB", ipa: "/blɒk/", audio: { url: "https://audio.test/block.wav" }, source: "britfone" },
      { id: "us", accent: "en-US", ipa: "/blɑk/", source: "cmudict" },
    ];
    const derived = deriveInflectedPronunciationVariants("blocks", "block", base);
    expect(derived.find((item) => item.accent === "en-GB")?.ipa).toBe("/blɒks/");
    expect(derived.find((item) => item.accent === "en-US")?.ipa).toBe("/blɑks/");
    expect(derived.every((item) => !item.audio)).toBe(true);
  });

  test("completes a missing accent from the lemma even when another accent is exact", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/florps.jsonl")) {
        return { ok: true, text: async () => JSON.stringify({ word: "florps", sounds: [{ tags: ["US"], ipa: "/flɔrps/" }] }) };
      }
      if (url.endsWith("/florp.jsonl")) {
        return { ok: true, text: async () => JSON.stringify({ word: "florp", sounds: [{ tags: ["UK"], ipa: "/flɔːp/" }] }) };
      }
      return { ok: false, text: async () => "" };
    });
    const result = await resolvePronunciation("florps", { fetchFn: fetchMock as never });
    expect(result.usPhonetic).toBe("/flɔrps/");
    expect(result.ukPhonetic).toBe("/flɔːps/");
  });

  test("does not relabel generic or Canadian pronunciation as US or UK", async () => {
    const generic = extractKaikkiPronunciationVariants(
      JSON.stringify({ word: "foobar", sounds: [{ tags: ["Canada"], ipa: "/ˈfuːbɑr/" }] }),
      "foobar",
    );
    expect(generic[0]?.accent).toBe("en");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ word: "foobar", sounds: [{ ipa: "/ˈfuːbɑr/" }] }),
    }));
    const result = await resolvePronunciation("foobar", { fetchFn: fetchMock as never });
    expect(result.selectedVariantIds).toEqual({});
    expect(result.ukPhonetic).toBeUndefined();
    expect(result.usPhonetic).toBeUndefined();
    expect(result.ttsAllowed).toBe(true);
  });

  test("returns the explicitly selected accent variant", () => {
    const result = {
      surface: "block",
      variants: [
        { id: "gb", accent: "en-GB", ipa: "/blɒk/", source: "britfone" },
        { id: "us", accent: "en-US", ipa: "/blɑk/", source: "cmudict" },
      ],
      selectedVariantIds: { "en-GB": "gb", "en-US": "us" },
      confidence: "exact",
      ttsAllowed: true,
      dataRevision: "test",
      cached: false,
    } as const;
    expect(getPronunciationVariantForAccent(result, "en-US")?.ipa).toBe("/blɑk/");
  });
});

test("resolves predictions from the lazy extended offline tier when the network is unavailable", async () => {
  const result = await resolvePronunciation("predictions", { fetchFn: failedFetch() as never });
  expect(result.ukPhonetic).toBeTruthy();
  expect(result.usPhonetic).toBeTruthy();
  expect(result.ukPhonetic).not.toBe("No IPA");
  expect(result.usPhonetic).not.toBe("No IPA");
});

test("uses exact audio while filling an audio-only accent with IPA", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/measuring.jsonl")) {
      return { ok: true, text: async () => JSON.stringify({
        word: "measuring",
        pos: "verb",
        sounds: [
          { tags: ["UK"], ipa: "/ˈmɛʒərɪŋ/" },
          { tags: ["US"], mp3_url: "https://audio.test/measuring-us.mp3" },
        ],
      }) };
    }
    return { ok: false, text: async () => "" };
  });
  const result = await resolvePronunciation("measuring", { partOfSpeech: "verb", fetchFn: fetchMock as never });
  expect(result.ukPhonetic).toBeTruthy();
  expect(result.usPhonetic).toBeTruthy();
  expect(result.usAudioUrl).toBe("https://audio.test/measuring-us.mp3");
});
