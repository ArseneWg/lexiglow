import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

async function write(path, content) {
  await writeFile(new URL("../" + path, import.meta.url), content.endsWith("\n") ? content : content + "\n", "utf8");
}

async function replaceExact(path, before, after) {
  const source = await read(path);
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error("Could not find expected pronunciation refactor anchor in " + path + ":\n" + before.slice(0, 180));
  }
  await write(path, source.replace(before, after));
}

const resolverSource = String.raw`import { getLemmaCandidates } from "./normalize";
import {
  LOCAL_UK_IPA,
  LOCAL_US_ARPABET,
  PRONUNCIATION_DATA_REVISION,
} from "../generated/pronunciationData";
import type {
  PronunciationAccent,
  PronunciationConfidence,
  PronunciationResult,
  PronunciationVariant,
} from "./types";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

interface KaikkiSoundLike {
  ipa?: string;
  tags?: string[];
  audio?: string;
  ogg_url?: string;
  mp3_url?: string;
  "audio-ipa"?: string;
}

interface KaikkiEntryLike {
  word?: string;
  pos?: string;
  sounds?: KaikkiSoundLike[];
}

interface CuratedReading {
  partOfSpeech: string;
  us: string;
  gb: string;
  context?: RegExp;
}

const KAIKKI_TIMEOUT_MS = 2500;
const KAIKKI_BASE_URL = "https://kaikki.org/dictionary/English/meaning";

const HETERONYM_READINGS: Readonly<Record<string, readonly CuratedReading[]>> = {
  refuse: [
    { partOfSpeech: "verb", us: "/rɪˈfjuːz/", gb: "/rɪˈfjuːz/", context: /\b(?:to|will|would|can|could|should|may|might|must|please|i|you|we|they)\s+refuse\b/i },
    { partOfSpeech: "noun", us: "/ˈrɛfjuːs/", gb: "/ˈrefjuːs/", context: /\b(?:the|this|that|some|household|solid)\s+refuse\b/i },
  ],
  record: [
    { partOfSpeech: "verb", us: "/rɪˈkɔrd/", gb: "/rɪˈkɔːd/", context: /\b(?:to|will|would|can|could|should|please|i|you|we|they)\s+record\b/i },
    { partOfSpeech: "noun", us: "/ˈrɛkɚd/", gb: "/ˈrekɔːd/", context: /\b(?:a|an|the|this|that|my|your|his|her|their|new|world|track)\s+record\b/i },
  ],
  lead: [
    { partOfSpeech: "verb", us: "/liːd/", gb: "/liːd/", context: /\b(?:to|will|would|can|could|should|i|you|we|they)\s+lead\b/i },
    { partOfSpeech: "noun", us: "/lɛd/", gb: "/led/", context: /\b(?:lead\s+(?:pipe|paint|poisoning|ore)|made\s+of\s+lead)\b/i },
  ],
  live: [
    { partOfSpeech: "verb", us: "/lɪv/", gb: "/lɪv/", context: /\b(?:i|you|we|they|people|who)\s+live\b/i },
    { partOfSpeech: "adjective", us: "/laɪv/", gb: "/laɪv/", context: /\blive\s+(?:music|show|event|stream|broadcast|performance|coverage)\b/i },
  ],
  read: [
    { partOfSpeech: "verb-past", us: "/rɛd/", gb: "/red/", context: /\b(?:yesterday|last\s+(?:night|week|year)|already|had|ago)\b/i },
    { partOfSpeech: "verb", us: "/riːd/", gb: "/riːd/", context: /\b(?:to|will|would|can|could|should|please|i|you|we|they)\s+read\b/i },
  ],
  present: [
    { partOfSpeech: "verb", us: "/prɪˈzɛnt/", gb: "/prɪˈzent/", context: /\b(?:to|will|would|can|could|should|please)\s+present\b/i },
    { partOfSpeech: "noun", us: "/ˈprɛzənt/", gb: "/ˈprezənt/", context: /\b(?:a|an|the|this|that|birthday|christmas)\s+present\b/i },
  ],
  object: [
    { partOfSpeech: "verb", us: "/əbˈdʒɛkt/", gb: "/əbˈdʒekt/", context: /\b(?:to|will|would|can|could|should|i|you|we|they)\s+object\b/i },
    { partOfSpeech: "noun", us: "/ˈɑbdʒɛkt/", gb: "/ˈɒbdʒɪkt/", context: /\b(?:a|an|the|this|that|physical|moving)\s+object\b/i },
  ],
  close: [
    { partOfSpeech: "verb", us: "/kloʊz/", gb: "/kləʊz/", context: /\b(?:to|will|would|can|could|should|please)\s+close\b/i },
    { partOfSpeech: "adjective", us: "/kloʊs/", gb: "/kləʊs/", context: /\bclose\s+(?:friend|relationship|match|call|connection|attention)\b/i },
  ],
  use: [
    { partOfSpeech: "verb", us: "/juːz/", gb: "/juːz/", context: /\b(?:to|will|would|can|could|should|please|i|you|we|they)\s+use\b/i },
    { partOfSpeech: "noun", us: "/juːs/", gb: "/juːs/", context: /\b(?:a|the|this|that|its|their|common|practical)\s+use\b/i },
  ],
  used: [
    { partOfSpeech: "verb-past", us: "/juːzd/", gb: "/juːzd/", context: /\b(?:i|you|we|they|he|she|it)\s+used\b/i },
    { partOfSpeech: "used-to", us: "/juːst/", gb: "/juːst/", context: /\bused\s+to\b/i },
  ],
};

const CMU_VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
const CMU_MAP: Readonly<Record<string, string>> = {
  AA: "ɑ", AE: "æ", AO: "ɔ", AW: "aʊ", AY: "aɪ", B: "b", CH: "tʃ", D: "d", DH: "ð",
  EH: "ɛ", EY: "eɪ", F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "dʒ", K: "k", L: "l",
  M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t",
  TH: "θ", UH: "ʊ", UW: "u", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

function normalizeSurface(value: string): string {
  return value.trim().toLowerCase().replace(/[’]/g, "'");
}

function normalizePos(value: string | undefined): string {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("v") || normalized.includes("verb")) return "verb";
  if (normalized.startsWith("n") || normalized.includes("noun")) return "noun";
  if (normalized.startsWith("adj") || normalized.includes("adjective")) return "adjective";
  if (normalized.startsWith("adv") || normalized.includes("adverb")) return "adverb";
  return normalized;
}

function stripIpaDelimiters(value: string | undefined): string {
  return (value || "").trim().replace(/^[/[]+|[/\]]+$/g, "");
}

function canonicalIpa(value: string | undefined): string {
  return stripIpaDelimiters(value)
    .normalize("NFKD")
    .replace(/[ˈˌ.\s]/g, "")
    .replace(/ɹ/g, "r")
    .replace(/ɚ/g, "ər")
    .replace(/ɝ/g, "ɜr")
    .replace(/ː/g, "");
}

function ipaEquivalent(left: string | undefined, right: string | undefined): boolean {
  const a = canonicalIpa(left);
  const b = canonicalIpa(right);
  return Boolean(a && b && a === b);
}

function classifyAccent(tags: readonly string[] | undefined): PronunciationAccent | "en" {
  const text = (tags || []).join(" ").toLowerCase();
  if (/\b(?:us|u\.s\.|general american|american|united states|canada|canadian)\b/.test(text)) return "en-US";
  if (/\b(?:uk|u\.k\.|rp|received pronunciation|british|england|southern england|great britain)\b/.test(text)) return "en-GB";
  return "en";
}

function stableVariantId(prefix: string, surface: string, accent: string, index: number): string {
  return [prefix, surface, accent, String(index)].join(":");
}

function buildKaikkiUrl(surface: string): string {
  const normalized = normalizeSurface(surface);
  return KAIKKI_BASE_URL + "/" + encodeURIComponent(normalized.slice(0, 1)) + "/" + encodeURIComponent(normalized.slice(0, 2)) + "/" + encodeURIComponent(normalized) + ".jsonl";
}

async function fetchWithTimeout(fetchFn: FetchLike, url: string): Promise<Awaited<ReturnType<FetchLike>> | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), KAIKKI_TIMEOUT_MS);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function extractKaikkiPronunciationVariants(raw: string, surface: string): PronunciationVariant[] {
  const normalizedSurface = normalizeSurface(surface);
  const variants: PronunciationVariant[] = [];
  let soundIndex = 0;

  for (const line of raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    let entry: KaikkiEntryLike | null = null;
    try {
      entry = JSON.parse(line) as KaikkiEntryLike;
    } catch {
      continue;
    }

    if (entry?.word && normalizeSurface(entry.word) !== normalizedSurface) continue;
    const sounds = Array.isArray(entry?.sounds) ? entry.sounds : [];
    for (const sound of sounds) {
      const audioIpa = typeof sound["audio-ipa"] === "string" ? sound["audio-ipa"]?.trim() : undefined;
      const ipa = audioIpa || (typeof sound.ipa === "string" ? sound.ipa.trim() : undefined);
      const audioUrl = typeof sound.mp3_url === "string" && sound.mp3_url.trim()
        ? sound.mp3_url.trim()
        : typeof sound.ogg_url === "string" && sound.ogg_url.trim()
          ? sound.ogg_url.trim()
          : undefined;
      if (!ipa && !audioUrl) continue;
      const accent = classifyAccent(sound.tags);
      variants.push({
        id: stableVariantId("kaikki", normalizedSurface, accent, soundIndex),
        accent,
        ipa: ipa || undefined,
        audio: audioUrl ? { url: audioUrl, audioIpa: audioIpa || undefined } : undefined,
        partOfSpeech: normalizePos(entry?.pos) || undefined,
        tags: Array.isArray(sound.tags) ? [...sound.tags] : undefined,
        source: "kaikki",
      });
      soundIndex += 1;
    }
  }

  return variants;
}

async function lookupKaikkiVariants(surface: string, fetchFn: FetchLike): Promise<PronunciationVariant[]> {
  const response = await fetchWithTimeout(fetchFn, buildKaikkiUrl(surface));
  if (!response?.ok) return [];
  const raw = await response.text().catch(() => "");
  return raw.trim() ? extractKaikkiPronunciationVariants(raw, surface) : [];
}

function parseArpabetToken(token: string): { phoneme: string; stress?: string } {
  const match = token.trim().toUpperCase().match(/^([A-Z]+)([012])?$/);
  return match ? { phoneme: match[1] || "", stress: match[2] } : { phoneme: token.trim().toUpperCase() };
}

function cmuToIpa(pronunciation: string): string | undefined {
  const tokens = pronunciation.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  let body = "";
  for (const token of tokens) {
    const parsed = parseArpabetToken(token);
    let sound: string | undefined;
    if (parsed.phoneme === "AH") sound = parsed.stress === "0" ? "ə" : "ʌ";
    else if (parsed.phoneme === "ER") sound = parsed.stress === "0" ? "ɚ" : "ɝ";
    else sound = CMU_MAP[parsed.phoneme];
    if (!sound) continue;
    if (CMU_VOWELS.has(parsed.phoneme)) {
      if (parsed.stress === "1") body += "ˈ";
      else if (parsed.stress === "2") body += "ˌ";
    }
    body += sound;
  }
  return body ? "/" + body + "/" : undefined;
}

function localVariants(surface: string): PronunciationVariant[] {
  const normalized = normalizeSurface(surface);
  const variants: PronunciationVariant[] = [];
  const uk = (LOCAL_UK_IPA as Readonly<Record<string, readonly string[]>>)[normalized] || [];
  const us = (LOCAL_US_ARPABET as Readonly<Record<string, readonly string[]>>)[normalized] || [];
  uk.forEach((ipa, index) => variants.push({
    id: stableVariantId("britfone", normalized, "en-GB", index),
    accent: "en-GB",
    ipa: ipa.trim(),
    source: "britfone",
  }));
  us.forEach((arpabet, index) => {
    const ipa = cmuToIpa(arpabet);
    if (!ipa) return;
    variants.push({
      id: stableVariantId("cmudict", normalized, "en-US", index),
      accent: "en-US",
      ipa,
      source: "cmudict",
    });
  });
  return variants;
}

function dedupeVariants(variants: readonly PronunciationVariant[]): PronunciationVariant[] {
  const seen = new Set<string>();
  const output: PronunciationVariant[] = [];
  for (const variant of variants) {
    const key = [variant.accent, canonicalIpa(variant.ipa), variant.audio?.url || "", variant.partOfSpeech || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(variant);
  }
  return output;
}

function scoreVariant(variant: PronunciationVariant, accent: PronunciationAccent, partOfSpeech?: string): number {
  let score = 0;
  if (variant.accent === accent) score += 100;
  else if (variant.accent === "en") score += 10;
  if (variant.audio?.url && variant.ipa) score += 80;
  else if (variant.audio?.url) score += 55;
  else if (variant.ipa) score += 35;
  if (variant.source === "kaikki") score += 20;
  if (partOfSpeech && normalizePos(variant.partOfSpeech) === normalizePos(partOfSpeech)) score += 25;
  return score;
}

function chooseVariant(variants: readonly PronunciationVariant[], accent: PronunciationAccent, partOfSpeech?: string): PronunciationVariant | undefined {
  return [...variants]
    .filter((variant) => variant.accent === accent || variant.accent === "en")
    .sort((left, right) => scoreVariant(right, accent, partOfSpeech) - scoreVariant(left, accent, partOfSpeech))[0];
}

function selectVariantIds(variants: readonly PronunciationVariant[], partOfSpeech?: string): Partial<Record<PronunciationAccent, string>> {
  const selected: Partial<Record<PronunciationAccent, string>> = {};
  const uk = chooseVariant(variants, "en-GB", partOfSpeech);
  const us = chooseVariant(variants, "en-US", partOfSpeech);
  if (uk) selected["en-GB"] = uk.id;
  if (us) selected["en-US"] = us.id;
  return selected;
}

function attachMatchingStructuredAudio(curated: PronunciationVariant[], structured: readonly PronunciationVariant[]): PronunciationVariant[] {
  return curated.map((variant) => {
    const match = structured.find((candidate) =>
      candidate.audio?.url &&
      (candidate.accent === variant.accent || candidate.accent === "en") &&
      ipaEquivalent(candidate.ipa, variant.ipa),
    );
    return match ? { ...variant, audio: match.audio } : variant;
  });
}

function resolveCuratedReading(surface: string, contextText?: string, partOfSpeech?: string): { variants: PronunciationVariant[]; confidence: PronunciationConfidence } | null {
  const readings = HETERONYM_READINGS[normalizeSurface(surface)];
  if (!readings?.length) return null;
  const normalizedPos = normalizePos(partOfSpeech);
  const context = contextText || "";
  const scored = readings.map((reading, index) => {
    let score = 0;
    const readingPos = normalizePos(reading.partOfSpeech);
    if (normalizedPos && readingPos === normalizedPos) score += 100;
    if (reading.context?.test(context)) score += 120;
    return { reading, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score === 0 || (second && second.score === best.score)) {
    const all = readings.flatMap((reading, readingIndex) => [
      { id: stableVariantId("curated", normalizeSurface(surface), "en-GB", readingIndex), accent: "en-GB" as const, ipa: reading.gb, partOfSpeech: reading.partOfSpeech, source: "curated" as const },
      { id: stableVariantId("curated", normalizeSurface(surface), "en-US", readingIndex), accent: "en-US" as const, ipa: reading.us, partOfSpeech: reading.partOfSpeech, source: "curated" as const },
    ]);
    return { variants: all, confidence: "ambiguous" };
  }

  return {
    confidence: "context-exact",
    variants: [
      { id: stableVariantId("curated", normalizeSurface(surface), "en-GB", best.index), accent: "en-GB", ipa: best.reading.gb, partOfSpeech: best.reading.partOfSpeech, source: "curated" },
      { id: stableVariantId("curated", normalizeSurface(surface), "en-US", best.index), accent: "en-US", ipa: best.reading.us, partOfSpeech: best.reading.partOfSpeech, source: "curated" },
    ],
  };
}

function unwrapIpa(value: string): { open: string; close: string; body: string } {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return { open: "[", close: "]", body: trimmed.slice(1, -1) };
  if (trimmed.startsWith("/") && trimmed.endsWith("/")) return { open: "/", close: "/", body: trimmed.slice(1, -1) };
  return { open: "/", close: "/", body: trimmed };
}

function finalIpaPhoneme(body: string): string {
  const compact = body.replace(/[ˈˌ.\s]/g, "").replace(/\([^)]*\)$/g, "");
  const multigraphs = ["tʃ", "dʒ"];
  for (const item of multigraphs) if (compact.endsWith(item)) return item;
  return compact.slice(-1);
}

export function appendInflectionToIpa(baseIpa: string, morphology: "s-ending" | "past-ed" | "progressive-ing"): string {
  const parsed = unwrapIpa(baseIpa);
  const final = finalIpaPhoneme(parsed.body);
  let suffix = "";
  if (morphology === "s-ending") {
    suffix = ["s", "z", "ʃ", "ʒ", "tʃ", "dʒ"].includes(final) ? "ɪz" : ["p", "t", "k", "f", "θ"].includes(final) ? "s" : "z";
  } else if (morphology === "past-ed") {
    suffix = ["t", "d"].includes(final) ? "ɪd" : ["p", "k", "f", "s", "ʃ", "tʃ", "θ"].includes(final) ? "t" : "d";
  } else {
    suffix = "ɪŋ";
  }
  return parsed.open + parsed.body + suffix + parsed.close;
}

function inferMorphology(surface: string, base: string): "s-ending" | "past-ed" | "progressive-ing" | null {
  const word = normalizeSurface(surface);
  const lemma = normalizeSurface(base);
  if (!lemma || word === lemma) return null;
  if (word.endsWith("ing")) return "progressive-ing";
  if (word.endsWith("ed") || word.endsWith("ied") || (lemma.endsWith("e") && word === lemma + "d")) return "past-ed";
  if (word.endsWith("s") || word.endsWith("es") || word.endsWith("ies")) return "s-ending";
  return null;
}

export function deriveInflectedPronunciationVariants(surface: string, base: string, baseVariants: readonly PronunciationVariant[]): PronunciationVariant[] {
  const morphology = inferMorphology(surface, base);
  if (!morphology) return [];
  return baseVariants
    .filter((variant) => variant.ipa && (variant.accent === "en-US" || variant.accent === "en-GB"))
    .map((variant, index) => ({
      id: stableVariantId("morphology", normalizeSurface(surface), variant.accent, index),
      accent: variant.accent,
      ipa: appendInflectionToIpa(variant.ipa as string, morphology),
      source: "morphology" as const,
      derivedFrom: normalizeSurface(base),
      morphology,
    }));
}

function buildResult(surface: string, variants: PronunciationVariant[], confidence: PronunciationConfidence, ttsAllowed: boolean, partOfSpeech?: string): Omit<PronunciationResult, "cached"> {
  const deduped = dedupeVariants(variants);
  const selectedVariantIds = confidence === "ambiguous" ? {} : selectVariantIds(deduped, partOfSpeech);
  const uk = selectedVariantIds["en-GB"] ? deduped.find((item) => item.id === selectedVariantIds["en-GB"]) : undefined;
  const us = selectedVariantIds["en-US"] ? deduped.find((item) => item.id === selectedVariantIds["en-US"]) : undefined;
  return {
    surface,
    variants: deduped,
    selectedVariantIds,
    confidence,
    ttsAllowed,
    dataRevision: PRONUNCIATION_DATA_REVISION,
    ukPhonetic: uk?.ipa,
    usPhonetic: us?.ipa,
    ukAudioUrl: uk?.audio?.url,
    usAudioUrl: us?.audio?.url,
  };
}

export function getPronunciationVariantForAccent(result: PronunciationResult | null | undefined, accent: PronunciationAccent): PronunciationVariant | undefined {
  if (!result) return undefined;
  const id = result.selectedVariantIds?.[accent];
  if (!id) return undefined;
  return result.variants.find((variant) => variant.id === id);
}

export async function resolvePronunciation(
  surface: string,
  options: { contextText?: string; partOfSpeech?: string; fetchFn?: FetchLike } = {},
): Promise<Omit<PronunciationResult, "cached">> {
  const normalized = normalizeSurface(surface);
  if (!normalized) return buildResult(surface, [], "tts-only", false, options.partOfSpeech);
  const fetchFn = options.fetchFn || (fetch as unknown as FetchLike);
  const structured = await lookupKaikkiVariants(normalized, fetchFn);

  const curated = resolveCuratedReading(normalized, options.contextText, options.partOfSpeech);
  if (curated) {
    if (curated.confidence === "ambiguous") {
      return buildResult(surface, curated.variants, "ambiguous", false, options.partOfSpeech);
    }
    const withAudio = attachMatchingStructuredAudio(curated.variants, structured);
    return buildResult(surface, withAudio, "context-exact", true, options.partOfSpeech);
  }

  const exact = dedupeVariants([...structured, ...localVariants(normalized)]);
  if (exact.length) return buildResult(surface, exact, "exact", true, options.partOfSpeech);

  const candidates = getLemmaCandidates(normalized).filter((candidate) => normalizeSurface(candidate) !== normalized).slice(0, 4);
  for (const base of candidates) {
    let baseVariants = localVariants(base);
    if (!baseVariants.length) baseVariants = await lookupKaikkiVariants(base, fetchFn);
    const derived = deriveInflectedPronunciationVariants(normalized, base, baseVariants);
    if (derived.length) return buildResult(surface, derived, "derived", true, options.partOfSpeech);
  }

  return buildResult(surface, [], "tts-only", true, options.partOfSpeech);
}
`;

const resolverTestSource = String.raw`import { describe, expect, test, vi } from "vitest";

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
`;

const refreshDataSource = String.raw`import { readFile, writeFile, mkdir } from "node:fs/promises";

const CMUDICT_REVISION = "74790861f652b15e4ac49015a90074ad62a27690";
const BRITFONE_REVISION = "1062be14adc96c358f2087ac5449d72130c7a6f4";
const CMUDICT_URL = "https://raw.githubusercontent.com/cmusphinx/cmudict/" + CMUDICT_REVISION + "/cmudict.dict";
const BRITFONE_URL = "https://raw.githubusercontent.com/JoseLlarena/Britfone/" + BRITFONE_REVISION + "/britfone.main.3.0.1.csv";
const EXTRA_WORDS = [
  "block", "blocks", "bus", "buses", "dog", "dogs", "look", "looked", "play", "played", "want", "wanted",
  "refuse", "record", "lead", "live", "read", "present", "object", "close", "use", "used", "obfuscation",
];

async function download(url) {
  const response = await fetch(url, { headers: { "user-agent": "LexiGlow-pronunciation-data-builder" } });
  if (!response.ok) throw new Error("Failed to download " + url + ": " + response.status);
  return response.text();
}

const lexicon = await readFile(new URL("../data/google-10000-english.txt", import.meta.url), "utf8");
const wanted = new Set(lexicon.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean));
EXTRA_WORDS.forEach((word) => wanted.add(word));

const [cmuRaw, britRaw] = await Promise.all([download(CMUDICT_URL), download(BRITFONE_URL)]);
const us = {};
for (const line of cmuRaw.split(/\r?\n/)) {
  const match = line.match(/^([^\s]+)\s+(.+)$/);
  if (!match) continue;
  const head = (match[1] || "").replace(/\(\d+\)$/u, "").toLowerCase();
  if (!wanted.has(head)) continue;
  (us[head] ||= []).push((match[2] || "").trim());
}

const uk = {};
for (const line of britRaw.split(/\r?\n/)) {
  const comma = line.indexOf(",");
  if (comma <= 0) continue;
  const rawHead = line.slice(0, comma).trim().replace(/\(\d+\)$/u, "");
  if (rawHead.includes("_")) continue;
  const head = rawHead.toLowerCase();
  if (!wanted.has(head)) continue;
  const ipa = line.slice(comma + 1).trim().replace(/\s+/g, "");
  if (!ipa) continue;
  (uk[head] ||= []).push("/" + ipa + "/");
}

for (const map of [us, uk]) {
  for (const key of Object.keys(map)) map[key] = [...new Set(map[key])];
}

const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
const revision = "cmudict:" + CMUDICT_REVISION + ";britfone:" + BRITFONE_REVISION;
const output = [
  "// Generated by scripts/refresh-pronunciation-data.mjs. Do not edit by hand.",
  "export const PRONUNCIATION_DATA_REVISION = " + JSON.stringify(revision) + ";",
  "export const LOCAL_US_ARPABET = " + JSON.stringify(sorted(us), null, 2) + " as const;",
  "export const LOCAL_UK_IPA = " + JSON.stringify(sorted(uk), null, 2) + " as const;",
  "",
].join("\n");

await mkdir(new URL("../src/generated", import.meta.url), { recursive: true });
await writeFile(new URL("../src/generated/pronunciationData.ts", import.meta.url), output, "utf8");
console.log("Generated pronunciation data for " + Object.keys(us).length + " US and " + Object.keys(uk).length + " UK headwords.");
`;

const e2eSource = String.raw`import { expect, test } from "./fixtures";
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
`;

const siteSource = String.raw`import type { Page } from "@playwright/test";

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
`;

const liveSiteSource = String.raw`import type { Page } from "@playwright/test";

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
  expect(await selectFirstWord(page, "component")).toBe(true);
  await expect(page.locator(".wordwise-pronunciation")).toBeVisible();
  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA", { timeout: 12_000 });
});
`;

await write("src/shared/pronunciationResolver.ts", resolverSource);
await write("tests/pronunciationResolver.test.ts", resolverTestSource);
await write("scripts/refresh-pronunciation-data.mjs", refreshDataSource);
await write("e2e/pronunciation-accuracy.spec.ts", e2eSource);
await write("e2e/sites/pronunciation-sites.spec.ts", siteSource);
await write("e2e/sites/pronunciation-live-source.spec.ts", liveSiteSource);

await replaceExact(
  "src/shared/types.ts",
  `export type PronunciationAccent = "en-GB" | "en-US";\n\nexport interface PronunciationResult {\n  ukPhonetic?: string;\n  usPhonetic?: string;\n  ukAudioUrl?: string;\n  usAudioUrl?: string;\n  cached: boolean;\n}`,
  `export type PronunciationAccent = "en-GB" | "en-US";\nexport type PronunciationSource = "kaikki" | "cmudict" | "britfone" | "morphology" | "curated";\nexport type PronunciationConfidence = "context-exact" | "exact" | "derived" | "ambiguous" | "tts-only";\nexport type PronunciationMorphology = "s-ending" | "past-ed" | "progressive-ing";\n\nexport interface PronunciationAudioInfo {\n  url: string;\n  audioIpa?: string;\n  sourcePage?: string;\n  author?: string;\n  license?: string;\n  licenseUrl?: string;\n}\n\nexport interface PronunciationVariant {\n  id: string;\n  accent: PronunciationAccent | "en";\n  ipa?: string;\n  audio?: PronunciationAudioInfo;\n  partOfSpeech?: string;\n  tags?: string[];\n  source: PronunciationSource;\n  derivedFrom?: string;\n  morphology?: PronunciationMorphology;\n}\n\nexport interface PronunciationResult {\n  surface: string;\n  variants: PronunciationVariant[];\n  selectedVariantIds?: Partial<Record<PronunciationAccent, string>>;\n  confidence: PronunciationConfidence;\n  ttsAllowed: boolean;\n  dataRevision: string;\n  ukPhonetic?: string;\n  usPhonetic?: string;\n  ukAudioUrl?: string;\n  usAudioUrl?: string;\n  cached: boolean;\n}`,
);

await replaceExact(
  "src/shared/types.ts",
  `export interface PronunciationCacheEntry {\n  ukPhonetic?: string;\n  usPhonetic?: string;\n  ukAudioUrl?: string;\n  usAudioUrl?: string;\n  updatedAt: number;\n}`,
  `export interface PronunciationCacheEntry {\n  surface: string;\n  variants: PronunciationVariant[];\n  selectedVariantIds?: Partial<Record<PronunciationAccent, string>>;\n  confidence: PronunciationConfidence;\n  ttsAllowed: boolean;\n  dataRevision: string;\n  ukPhonetic?: string;\n  usPhonetic?: string;\n  ukAudioUrl?: string;\n  usAudioUrl?: string;\n  updatedAt: number;\n}`,
);

await replaceExact(
  "src/shared/messages.ts",
  `export interface LookupPronunciationMessage {\n  type: "LOOKUP_PRONUNCIATION";\n  payload: {\n    surface: string;\n  };\n}`,
  `export interface LookupPronunciationMessage {\n  type: "LOOKUP_PRONUNCIATION";\n  payload: {\n    surface: string;\n    contextText?: string;\n    partOfSpeech?: string;\n  };\n}`,
);

await replaceExact(
  "src/background/index.ts",
  `import {\n  hasEnglishVoice,\n  lookupBestPronunciation,\n  selectVoiceForAccent,\n} from "../shared/pronunciation";`,
  `import {\n  hasEnglishVoice,\n  selectVoiceForAccent,\n} from "../shared/pronunciation";\nimport { resolvePronunciation } from "../shared/pronunciationResolver";`,
);

await replaceExact(
  "src/background/index.ts",
  `async function getOrLookupPronunciation(surface: string): Promise<PronunciationResult> {\n  const normalized = surface.trim().toLowerCase();\n\n  if (!normalized) {\n    return {\n      cached: false,\n    };\n  }\n\n  const translatorSettings = await getTranslatorSettings();\n  const cacheTtlMs = getTranslatorCacheTtlMs(translatorSettings);\n  const cached = pronunciationCache.get(normalized);\n\n  if (cached) {\n    return {\n      ukPhonetic: cached.ukPhonetic,\n      usPhonetic: cached.usPhonetic,\n      ukAudioUrl: cached.ukAudioUrl,\n      usAudioUrl: cached.usAudioUrl,\n      cached: true,\n    };\n  }\n\n  let pending = inFlightPronunciations.get(normalized);\n\n  if (!pending) {\n    pending = (async () => {\n      const result = await lookupBestPronunciation(normalized);\n\n      pronunciationCache.set(normalized, {\n        ukPhonetic: result.ukPhonetic,\n        usPhonetic: result.usPhonetic,\n        ukAudioUrl: result.ukAudioUrl,\n        usAudioUrl: result.usAudioUrl,\n        updatedAt: Date.now(),\n      }, cacheTtlMs);\n\n      return {\n        ...result,\n        cached: false,\n      };\n    })();\n\n    inFlightPronunciations.set(normalized, pending);\n  }\n\n  try {\n    return await pending;\n  } finally {\n    inFlightPronunciations.delete(normalized);\n  }\n}\n\n\nasync function handleLookupPronunciation(\n  message: LookupPronunciationMessage,\n): Promise<PronunciationLookupResponse["result"]> {\n  return getOrLookupPronunciation(message.payload.surface);\n}`,
  `async function getOrLookupPronunciation(\n  surface: string,\n  contextText?: string,\n  partOfSpeech?: string,\n): Promise<PronunciationResult> {\n  const normalized = surface.trim().toLowerCase();\n\n  if (!normalized) {\n    return {\n      surface,\n      variants: [],\n      selectedVariantIds: {},\n      confidence: "tts-only",\n      ttsAllowed: false,\n      dataRevision: "empty",\n      cached: false,\n    };\n  }\n\n  const translatorSettings = await getTranslatorSettings();\n  const cacheTtlMs = getTranslatorCacheTtlMs(translatorSettings);\n  const normalizedContext = (contextText ?? "").trim().toLowerCase().slice(0, 600);\n  const normalizedPos = (partOfSpeech ?? "").trim().toLowerCase();\n  const requestKey = [normalized, normalizedPos, normalizedContext].join("::");\n  const cached = pronunciationCache.get(requestKey);\n\n  if (cached) {\n    return { ...cached, cached: true };\n  }\n\n  let pending = inFlightPronunciations.get(requestKey);\n\n  if (!pending) {\n    pending = (async () => {\n      const result = await resolvePronunciation(normalized, { contextText, partOfSpeech });\n      pronunciationCache.set(requestKey, {\n        ...result,\n        updatedAt: Date.now(),\n      }, cacheTtlMs);\n      return { ...result, cached: false };\n    })();\n    inFlightPronunciations.set(requestKey, pending);\n  }\n\n  try {\n    return await pending;\n  } finally {\n    inFlightPronunciations.delete(requestKey);\n  }\n}\n\n\nasync function handleLookupPronunciation(\n  message: LookupPronunciationMessage,\n): Promise<PronunciationLookupResponse["result"]> {\n  return getOrLookupPronunciation(\n    message.payload.surface,\n    message.payload.contextText,\n    message.payload.partOfSpeech,\n  );\n}`,
);

await replaceExact(
  "src/background/index.ts",
  `        if (\n          event.type === "start" ||\n          event.type === "end" ||\n          event.type === "interrupted" ||\n          event.type === "cancelled"\n        ) {\n          settled = true;\n          resolve();\n        }`,
  `        if (event.type === "end") {\n          settled = true;\n          resolve();\n          return;\n        }\n\n        if (event.type === "interrupted" || event.type === "cancelled") {\n          settled = true;\n          reject(new Error(ui(learnerLanguageCode, "errorPronunciationPlaybackFailed")));\n        }`,
);

await replaceExact(
  "src/content/index.ts",
  `import type {\n  LexiconLookupResult,\n  PronunciationAccent,\n  PronunciationResult,`,
  `import { getPronunciationVariantForAccent } from "../shared/pronunciationResolver";\nimport type {\n  LexiconLookupResult,\n  PronunciationAccent,\n  PronunciationResult,`,
);

await replaceExact(
  "src/content/index.ts",
  `function setWordTooltipControls(mode: "word" | "selection") {\n  const isSelection = mode === "selection";`,
  `function setWordTooltipControls(mode: "word" | "selection", selectionText = "") {\n  const isSelection = mode === "selection";\n  const showSelectionPronunciation = isSelection && isSingleEnglishWord(selectionText);`,
);

await replaceExact(
  "src/content/index.ts",
  `  tooltip.pronunciationEl.dataset.visible = isSelection ? "false" : "true";`,
  `  tooltip.pronunciationEl.dataset.visible = !isSelection || showSelectionPronunciation ? "true" : "false";`,
);

await replaceExact(
  "src/content/index.ts",
  `async function loadPronunciation(surface: string) {`,
  `async function loadPronunciation(surface: string, contextText?: string, partOfSpeech?: string) {`,
);

await replaceExact(
  "src/content/index.ts",
  `      payload: {\n        surface: normalizedSurface,\n      },`,
  `      payload: {\n        surface: normalizedSurface,\n        contextText,\n        partOfSpeech,\n      },`,
);

await replaceExact(
  "src/content/index.ts",
  `    !response.ok ||\n    requestId !== activePronunciationRequestId ||\n    isSelectionTooltipSession(tooltipSession) ||\n    activePronunciationSurface !== normalizedSurface`,
  `    !response.ok ||\n    requestId !== activePronunciationRequestId ||\n    activePronunciationSurface !== normalizedSurface`,
);

await replaceExact(
  "src/content/index.ts",
  `  activePronunciationResult = response.result ?? null;\n  tooltip.britishPhoneticEl.textContent = formatPronunciationDisplayText(\n    response.result?.ukPhonetic,\n    response.result?.ukAudioUrl,\n  );\n  tooltip.americanPhoneticEl.textContent = formatPronunciationDisplayText(\n    response.result?.usPhonetic,\n    response.result?.usAudioUrl,\n  );`,
  `  activePronunciationResult = response.result ?? null;\n  const britishVariant = getPronunciationVariantForAccent(activePronunciationResult, "en-GB");\n  const americanVariant = getPronunciationVariantForAccent(activePronunciationResult, "en-US");\n  if (response.result?.confidence === "ambiguous") {\n    tooltip.britishPhoneticEl.textContent = "Multiple pronunciations";\n    tooltip.americanPhoneticEl.textContent = "Multiple pronunciations";\n    return;\n  }\n  tooltip.britishPhoneticEl.textContent = formatPronunciationDisplayText(\n    britishVariant?.ipa ?? response.result?.ukPhonetic,\n    britishVariant?.audio?.url ?? response.result?.ukAudioUrl,\n  );\n  tooltip.americanPhoneticEl.textContent = formatPronunciationDisplayText(\n    americanVariant?.ipa ?? response.result?.usPhonetic,\n    americanVariant?.audio?.url ?? response.result?.usAudioUrl,\n  );`,
);

await replaceExact(
  "src/content/index.ts",
  `  setWordTooltipControls("selection");`,
  `  setWordTooltipControls("selection", context.text);`,
);

await replaceExact(
  "src/content/index.ts",
  `  activePronunciationRequestId += 1;\n  activePronunciationSurface = "";\n  activeContext = null;\n  activeResult = null;\n  positionTooltip(context.rect);`,
  `  activeContext = null;\n  activeResult = null;\n  if (isSingleEnglishWord(context.text)) {\n    const surface = normalizeSingleEnglishWord(context.text) || context.text;\n    if (activePronunciationSurface !== surface) {\n      resetPronunciationDisplay(surface);\n      void loadPronunciation(surface, context.contextText);\n    }\n  } else {\n    activePronunciationRequestId += 1;\n    activePronunciationSurface = "";\n    activePronunciationResult = null;\n  }\n  positionTooltip(context.rect);`,
);

await replaceExact(
  "src/content/index.ts",
  `    void loadPronunciation(result.surface);`,
  `    void loadPronunciation(\n      result.surface,\n      activeContext?.contextText,\n      result.contextualPartOfSpeech ?? result.partOfSpeech,\n    );`,
);

await replaceExact(
  "src/content/index.ts",
  `async function speakPronunciation(accent: PronunciationAccent) {\n  if (!activeResult?.surface || isSelectionTooltipSession(tooltipSession)) {\n    return;\n  }\n\n  const button = accent === "en-GB" ? tooltip.britishButton : tooltip.americanButton;\n  const audioUrl = accent === "en-GB"\n    ? activePronunciationResult?.ukAudioUrl\n    : activePronunciationResult?.usAudioUrl;\n\n  let response: PronunciationResponse;\n\n  showPronunciationFeedback(button);\n\n  try {\n    response = await runtimeSend<PronunciationResponse>({\n      type: "SPEAK_PRONUNCIATION",\n      payload: {\n        text: activeResult.surface,\n        accent,\n      },\n    });\n  } catch (error) {\n    if (isExtensionContextInvalidated(error)) {\n      hideTooltip();\n      return;\n    }\n\n    throw error;\n  }\n\n  if (!response.ok) {\n    button.dataset.playing = "false";\n\n    if (audioUrl) {\n      const played = await playPronunciationAudio(audioUrl, button);\n\n      if (played) {\n        return;\n      }\n    }\n\n    tooltip.hintEl.dataset.visible = "true";\n    tooltip.hintEl.dataset.loading = "false";\n    tooltip.hintEl.textContent = response.error ?? ui("tooltipPronunciationUnavailable");\n  }\n}`,
  `async function speakPronunciation(accent: PronunciationAccent) {\n  const selectedSurface = activeResult?.surface ?? (\n    activeSelectionTooltipContext && isSingleEnglishWord(activeSelectionTooltipContext.text)\n      ? normalizeSingleEnglishWord(activeSelectionTooltipContext.text)\n      : ""\n  );\n  if (!selectedSurface) return;\n\n  const button = accent === "en-GB" ? tooltip.britishButton : tooltip.americanButton;\n  const variant = getPronunciationVariantForAccent(activePronunciationResult, accent);\n  const audioUrl = variant?.audio?.url ?? (accent === "en-GB"\n    ? activePronunciationResult?.ukAudioUrl\n    : activePronunciationResult?.usAudioUrl);\n\n  showPronunciationFeedback(button);\n\n  if (audioUrl) {\n    const played = await playPronunciationAudio(audioUrl, button);\n    if (played) return;\n  }\n\n  if (activePronunciationResult?.ttsAllowed === false) {\n    button.dataset.playing = "false";\n    tooltip.hintEl.dataset.visible = "true";\n    tooltip.hintEl.dataset.loading = "false";\n    tooltip.hintEl.textContent = ui("tooltipPronunciationUnavailable");\n    return;\n  }\n\n  let response: PronunciationResponse;\n  try {\n    response = await runtimeSend<PronunciationResponse>({\n      type: "SPEAK_PRONUNCIATION",\n      payload: { text: selectedSurface, accent },\n    });\n  } catch (error) {\n    if (isExtensionContextInvalidated(error)) {\n      hideTooltip();\n      return;\n    }\n    throw error;\n  }\n\n  if (!response.ok) {\n    button.dataset.playing = "false";\n    tooltip.hintEl.dataset.visible = "true";\n    tooltip.hintEl.dataset.loading = "false";\n    tooltip.hintEl.textContent = response.error ?? ui("tooltipPronunciationUnavailable");\n  }\n}`,
);

const packageJson = JSON.parse(await read("package.json"));
packageJson.scripts ||= {};
packageJson.scripts["refresh:pronunciation-data"] = "node scripts/refresh-pronunciation-data.mjs";
await write("package.json", JSON.stringify(packageJson, null, 2));

const notices = await read("THIRD_PARTY_NOTICES.md");
if (!notices.includes("CMU Pronouncing Dictionary (pronunciation data)")) {
  await write("THIRD_PARTY_NOTICES.md", notices.trimEnd() + String.raw`

## CMU Pronouncing Dictionary (pronunciation data)

LexiGlow ships a generated subset of CMUdict for offline US-English pronunciation fallback. The source is pinned to revision 74790861f652b15e4ac49015a90074ad62a27690. CMUdict permits unrestricted research and commercial use and requests acknowledgement of origin. The generated subset is refreshed with scripts/refresh-pronunciation-data.mjs.

## Britfone (pronunciation data)

LexiGlow ships a generated subset of Britfone for offline Standard Southern British / RP pronunciation fallback. The source is pinned to revision 1062be14adc96c358f2087ac5449d72130c7a6f4 and is distributed under the MIT License. The generated subset is refreshed with scripts/refresh-pronunciation-data.mjs.

## Wiktionary / Wiktextract-derived pronunciation metadata

At runtime LexiGlow may retrieve structured English pronunciation records from Kaikki/Wiktextract-derived data, including IPA, dialect tags, and Wikimedia Commons audio URLs. Audio and entry licensing/attribution can vary by source item; LexiGlow preserves pronunciation variants atomically and does not treat unrelated IPA and audio records as interchangeable.
`);
}

const readme = await read("README.md");
if (!readme.includes("### Pronunciation accuracy pipeline")) {
  await write("README.md", readme.trimEnd() + String.raw`

### Pronunciation accuracy pipeline

LexiGlow treats pronunciation as a lexical-reading problem rather than a spelling-only TTS action. Exact single-word selections receive UK/US pronunciation when available. Structured Kaikki/Wiktextract pronunciation variants are kept atomic (IPA, audio/audio-IPA, accent/POS tags), pinned offline CMUdict/Britfone subsets provide reproducible fallback data, common heteronyms are resolved from context/POS when confidence is high, and regular -s/-ed/-ing forms can be derived from the base phonemes without reusing base-word audio. Human lexical audio is played before Chrome TTS; TTS always receives the exact selected surface and is disabled for unresolved ambiguous heteronyms. Source IPA is displayed without destructive DJ-style conversion.
`);
}

console.log("Pronunciation accuracy refactor applied.");
