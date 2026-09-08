import { getLemmaCandidates } from "./normalize";
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
    { partOfSpeech: "verb-past", us: "/rɛd/", gb: "/red/", context: /(?:\bread\b[^.!?]{0,80}\b(?:yesterday|last\s+(?:night|week|year)|ago)\b|\b(?:have|has|had)\s+(?:already\s+)?read\b)/i },
    { partOfSpeech: "verb", us: "/riːd/", gb: "/riːd/", context: /\b(?:(?:to|will|would|can|could|should|please)\s+read|(?:i|you|we|they)\s+read\s+(?:every|each|often|usually|daily|regularly|books?|articles?|news|aloud))\b/i },
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
    { partOfSpeech: "verb-past", us: "/juːzd/", gb: "/juːzd/", context: /\b(?:i|you|we|they|he|she|it)\s+used(?!\s+to\b)/i },
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
  const trimmed = (value || "").trim();
  if ((trimmed.startsWith("/") && trimmed.endsWith("/")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

export function getPronunciationVariantForAccent(
  result: (Pick<PronunciationResult, "selectedVariantIds"> & { variants: readonly PronunciationVariant[] }) | null | undefined,
  accent: PronunciationAccent,
): PronunciationVariant | undefined {
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
