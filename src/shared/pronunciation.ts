import { lookupRank } from "./lexicon";
import { getLemmaCandidates } from "./normalize";
import type { PronunciationAccent, PronunciationResult } from "./types";

export interface TtsVoiceLike {
  voiceName?: string;
  lang?: string;
  remote?: boolean;
  eventTypes?: string[];
}

export interface DictionaryPhoneticLike {
  text?: string;
  audio?: string;
  sourceUrl?: string;
}

export interface DictionaryEntryLike {
  phonetic?: string;
  phonetics?: DictionaryPhoneticLike[];
}

type PronunciationData = Omit<PronunciationResult, "cached">;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const PRONUNCIATION_REQUEST_TIMEOUT_MS = 2500;
const CMUDICT_REQUEST_TIMEOUT_MS = 8000;
const DICTIONARY_API_BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en";
const KAIKKI_JSONL_BASE_URL = "https://kaikki.org/dictionary/English/meaning";
const WIKTIONARY_RAW_PAGE_URL = "https://en.wiktionary.org/w/index.php?action=raw&title=";
const WIKIMEDIA_FILE_PATH_URL = "https://commons.wikimedia.org/wiki/Special:FilePath/";
const CMUDICT_SOURCE_URLS = [
  "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict",
  "https://cdn.jsdelivr.net/gh/cmusphinx/cmudict@master/cmudict.dict",
];

const CMUDICT_VOWELS = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AX",
  "AXR",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IX",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
  "UX",
]);

const CMUDICT_SINGLE_ONSETS = new Set([
  "B",
  "CH",
  "D",
  "DH",
  "F",
  "G",
  "HH",
  "JH",
  "K",
  "L",
  "M",
  "N",
  "P",
  "R",
  "S",
  "SH",
  "T",
  "TH",
  "V",
  "W",
  "Y",
  "Z",
  "ZH",
]);

const CMUDICT_COMPLEX_ONSETS = new Set([
  "B L",
  "B R",
  "D R",
  "D W",
  "F L",
  "F R",
  "F Y",
  "G L",
  "G R",
  "G W",
  "HH Y",
  "K L",
  "K R",
  "K W",
  "K Y",
  "M Y",
  "N Y",
  "P L",
  "P R",
  "P Y",
  "S F",
  "S K",
  "S L",
  "S M",
  "S N",
  "S P",
  "S T",
  "S W",
  "SH R",
  "T R",
  "T W",
  "TH R",
  "V Y",
]);

const CMUDICT_IPA_MAP = new Map<string, string>([
  ["AA", "ɑː"],
  ["AE", "æ"],
  ["AO", "ɔː"],
  ["AW", "aʊ"],
  ["AY", "aɪ"],
  ["B", "b"],
  ["CH", "tʃ"],
  ["D", "d"],
  ["DH", "ð"],
  ["EH", "ɛ"],
  ["EY", "eɪ"],
  ["F", "f"],
  ["G", "ɡ"],
  ["HH", "h"],
  ["IH", "ɪ"],
  ["IY", "iː"],
  ["JH", "dʒ"],
  ["K", "k"],
  ["L", "l"],
  ["M", "m"],
  ["N", "n"],
  ["NG", "ŋ"],
  ["OW", "oʊ"],
  ["OY", "ɔɪ"],
  ["P", "p"],
  ["R", "ɹ"],
  ["S", "s"],
  ["SH", "ʃ"],
  ["T", "t"],
  ["TH", "θ"],
  ["UH", "ʊ"],
  ["UW", "uː"],
  ["V", "v"],
  ["W", "w"],
  ["Y", "j"],
  ["Z", "z"],
  ["ZH", "ʒ"],
]);

interface KaikkiSoundLike {
  ipa?: string;
  tags?: string[];
  audio?: string;
  ogg_url?: string;
  mp3_url?: string;
}

interface KaikkiEntryLike {
  sounds?: KaikkiSoundLike[];
}

let cmudictTextPromise: Promise<string | null> | null = null;
const cmudictLookupCache = new Map<string, string | null>();

function normalizeLang(lang: string | undefined): string {
  return (lang ?? "").trim().toLowerCase();
}

function normalizeVoiceName(voiceName: string | undefined): string {
  return (voiceName ?? "").trim().toLowerCase();
}

function exactLangAliases(accent: PronunciationAccent): string[] {
  return accent === "en-GB"
    ? ["en-gb", "en_gb", "en-gb-x-gb", "en-gb-oed", "en-uk"]
    : ["en-us", "en_us", "en-us-x-us", "en-us-x-tpd"];
}

function voiceNameRegex(accent: PronunciationAccent): RegExp {
  return accent === "en-GB"
    ? /\b(english\s*\(?uk\)?|british|great britain|united kingdom|en-gb|en_gb|uk)\b/i
    : /\b(english\s*\(?us\)?|american|united states|en-us|en_us|us)\b/i;
}

function preferredVoicePatterns(accent: PronunciationAccent): RegExp[] {
  return accent === "en-GB"
    ? [/\bdaniel\b/i, /\breed\b/i, /\brocko\b/i, /\beddy\b/i]
    : [/\breed\b/i, /\beddy\b/i, /\brocko\b/i, /\balex\b/i, /\bralph\b/i, /\bfred\b/i];
}

const NOVELTY_VOICE_PATTERNS = [
  /\bbad news\b/i,
  /\bbahh\b/i,
  /\bbells\b/i,
  /\bboing\b/i,
  /\bbubbles\b/i,
  /\bcellos\b/i,
  /\bgood news\b/i,
  /\bjester\b/i,
  /\borgan\b/i,
  /\bsuperstar\b/i,
  /\btrinoids\b/i,
  /\bwhisper\b/i,
  /\bwobble\b/i,
  /\bzarvox\b/i,
];

function matchesAccent(voice: TtsVoiceLike, accent: PronunciationAccent): boolean {
  const lang = normalizeLang(voice.lang);
  const voiceName = normalizeVoiceName(voice.voiceName);

  if (exactLangAliases(accent).some((alias) => lang.includes(alias))) {
    return true;
  }

  return voiceNameRegex(accent).test(voiceName);
}

function scoreVoice(voice: TtsVoiceLike, accent: PronunciationAccent): number {
  const lang = normalizeLang(voice.lang);
  const voiceName = normalizeVoiceName(voice.voiceName);
  let score = 0;

  if (!voice.remote) {
    score += 120;
  }

  if (exactLangAliases(accent).some((alias) => lang === alias || lang.startsWith(`${alias}-`))) {
    score += 220;
  } else if (matchesAccent(voice, accent)) {
    score += 120;
  }

  const preferredIndex = preferredVoicePatterns(accent).findIndex((pattern) => pattern.test(voiceName));

  if (preferredIndex >= 0) {
    score += 300 - preferredIndex * 20;
  }

  if (NOVELTY_VOICE_PATTERNS.some((pattern) => pattern.test(voiceName))) {
    score -= 500;
  }

  return score;
}

function isEnglishVoice(voice: TtsVoiceLike): boolean {
  const lang = normalizeLang(voice.lang);
  const voiceName = normalizeVoiceName(voice.voiceName);

  return lang.startsWith("en") || voiceName.includes("english");
}

export function convertIpaToDj(value: string | undefined): string | undefined {
  const body = (value ?? "").trim().replace(/^\/+|\/+$/g, "");

  if (!body) {
    return undefined;
  }

  return body
    .replace(/ɜː/g, "ə:")
    .replace(/ɝ/g, "ə:r")
    .replace(/ɚ/g, "ər")
    .replace(/ː/g, ":")
    .replace(/oʊ/g, "əʊ")
    .replace(/eɪ/g, "ei")
    .replace(/ɛ/g, "e")
    .replace(/ɹ/g, "r")
    .replace(/̬/g, "");
}

function normalizePhoneticText(value: string | undefined): string | undefined {
  const compact = (value ?? "").trim();

  if (!compact) {
    return undefined;
  }

  const converted = convertIpaToDj(compact);

  return converted ? `/${converted}/` : undefined;
}

function markerRegex(accent: PronunciationAccent): RegExp {
  return accent === "en-GB"
    ? /(^|[^a-z])(uk|gb|british|united-kingdom|great-britain)([^a-z]|$)/i
    : /(^|[^a-z])(us|american|united-states)([^a-z]|$)/i;
}

function pickAccentPhonetic(
  phonetics: DictionaryPhoneticLike[],
  accent: PronunciationAccent,
): string | undefined {
  const withText = phonetics.filter((item) => typeof item.text === "string" && item.text.trim());
  const matched = withText.find((item) =>
    markerRegex(accent).test(`${item.audio ?? ""} ${item.sourceUrl ?? ""}`.toLowerCase()),
  );

  if (matched) {
    return normalizePhoneticText(matched.text);
  }

  return undefined;
}

function countDistinctSignals(values: Array<string | undefined>): number {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function getPronunciationStrength(result: PronunciationData): number {
  const phonetics = countDistinctSignals([result.ukPhonetic, result.usPhonetic]);
  const audios = countDistinctSignals([result.ukAudioUrl, result.usAudioUrl]);

  return (phonetics > 0 ? 100 : 0) + phonetics * 10 + audios;
}

function hasPronunciationData(result: PronunciationData): boolean {
  return getPronunciationStrength(result) > 0;
}

function hasPhoneticData(result: PronunciationData): boolean {
  return Boolean(result.ukPhonetic || result.usPhonetic);
}

function pickBetterPronunciation(
  left: PronunciationData | null,
  right: PronunciationData | null,
): PronunciationData | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return getPronunciationStrength(right) > getPronunciationStrength(left) ? right : left;
}

function mergePronunciationData(
  primary: PronunciationData,
  fallback: PronunciationData,
): PronunciationData {
  const primaryLooksGeneric =
    Boolean(primary.ukPhonetic) &&
    primary.ukPhonetic === primary.usPhonetic;
  const primaryHasGenericAudio =
    Boolean(primary.ukAudioUrl) &&
    primary.ukAudioUrl === primary.usAudioUrl;

  let ukAudioUrl = primary.ukAudioUrl ?? fallback.ukAudioUrl;
  let usAudioUrl = primary.usAudioUrl ?? fallback.usAudioUrl;

  if (primaryHasGenericAudio && (fallback.ukAudioUrl || fallback.usAudioUrl)) {
    ukAudioUrl = fallback.ukAudioUrl ?? (fallback.usAudioUrl ? undefined : primary.ukAudioUrl);
    usAudioUrl = fallback.usAudioUrl ?? (fallback.ukAudioUrl ? undefined : primary.usAudioUrl);
  }

  return {
    ukPhonetic: primaryLooksGeneric
      ? fallback.ukPhonetic ?? primary.ukPhonetic
      : primary.ukPhonetic ?? fallback.ukPhonetic,
    usPhonetic: primaryLooksGeneric
      ? fallback.usPhonetic ?? primary.usPhonetic
      : primary.usPhonetic ?? fallback.usPhonetic,
    ukAudioUrl,
    usAudioUrl,
  };
}

function scorePronunciationCandidate(candidate: string, index: number): number {
  let score = -index;

  if (lookupRank(candidate) !== null) {
    score += 100;
  }

  if (candidate.endsWith("fe")) {
    score += 15;
  } else if (/[eyf]$/.test(candidate)) {
    score += 10;
  }

  return score;
}

export function buildPronunciationCandidates(surface: string): string[] {
  const candidates = getLemmaCandidates(surface);

  if (!candidates.length) {
    return [];
  }

  const [exact, ...variants] = candidates;

  return [
    exact,
    ...variants
      .map((candidate, index) => ({
        candidate,
        index,
        score: scorePronunciationCandidate(candidate, index),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.candidate),
  ].filter((candidate, index, values) => values.indexOf(candidate) === index).slice(0, 4);
}

export function extractPronunciation(entry: DictionaryEntryLike): {
  ukPhonetic?: string;
  usPhonetic?: string;
  ukAudioUrl?: string;
  usAudioUrl?: string;
} {
  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
  const generic = normalizePhoneticText(
    typeof entry.phonetic === "string"
      ? entry.phonetic
      : phonetics.find((item) => typeof item.text === "string" && item.text.trim())?.text,
  );

  const ukPhonetic = pickAccentPhonetic(phonetics, "en-GB") ?? generic;
  const usPhonetic = pickAccentPhonetic(phonetics, "en-US") ?? generic;
  const ukAudioUrl = phonetics.find((item) =>
    typeof item.audio === "string" &&
    item.audio.trim() &&
    markerRegex("en-GB").test(`${item.audio ?? ""} ${item.sourceUrl ?? ""}`.toLowerCase()),
  )?.audio?.trim();
  const usAudioUrl = phonetics.find((item) =>
    typeof item.audio === "string" &&
    item.audio.trim() &&
    markerRegex("en-US").test(`${item.audio ?? ""} ${item.sourceUrl ?? ""}`.toLowerCase()),
  )?.audio?.trim();

  return {
    ukPhonetic,
    usPhonetic,
    ukAudioUrl: ukAudioUrl || undefined,
    usAudioUrl: usAudioUrl || undefined,
  };
}

export function extractBestPronunciationEntry(entries: DictionaryEntryLike[]): PronunciationData {
  let best: PronunciationData | null = null;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    best = pickBetterPronunciation(best, extractPronunciation(entry));
  }

  return best ?? {};
}

function getHeadingLevel(line: string): number | null {
  const match = line.match(/^(=+)[^=].*[^=]\1$/);
  return match ? match[1].length : null;
}

function extractNamedSection(content: string, heading: string, level: number): string {
  const targetHeading = `${"=".repeat(level)}${heading}${"=".repeat(level)}`;
  const lines = content.split(/\r?\n/);
  let collecting = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (!collecting) {
      if (line.trim() === targetHeading) {
        collecting = true;
      }

      continue;
    }

    const headingLevel = getHeadingLevel(line.trim());

    if (headingLevel !== null && headingLevel <= level) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function parseTemplateFields(body: string): {
  positional: string[];
  named: Map<string, string>;
} {
  const positional: string[] = [];
  const named = new Map<string, string>();

  for (const segment of body.split("|").map((part) => part.trim()).filter(Boolean)) {
    const separatorIndex = segment.indexOf("=");

    if (separatorIndex > 0) {
      named.set(
        segment.slice(0, separatorIndex).trim(),
        segment.slice(separatorIndex + 1).trim(),
      );
      continue;
    }

    positional.push(segment);
  }

  return { positional, named };
}

function resolveWiktionaryAccentHint(value: string | undefined): PronunciationAccent | undefined {
  const normalized = (value ?? "").trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (/\b(us|u\.s\.|ga|general[- ]american|american|canada|canadian)\b/.test(normalized)) {
    return "en-US";
  }

  if (/\b(uk|u\.k\.|rp|british|gb|england|southern[- ]england|received[- ]pronunciation)\b/.test(normalized)) {
    return "en-GB";
  }

  return undefined;
}

function extractInlineAccentHint(line: string): string | undefined {
  const matches = [...line.matchAll(/\{\{a\|([^{}]+?)\}\}/g)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);

  return matches.length ? matches.join(", ") : undefined;
}

function toWikimediaFileUrl(fileName: string): string {
  return `${WIKIMEDIA_FILE_PATH_URL}${encodeURIComponent(fileName.trim())}`;
}

export function extractPronunciationFromWiktionaryRaw(raw: string): PronunciationData {
  const englishSection = extractNamedSection(raw, "English", 2);

  if (!englishSection) {
    return {};
  }

  const pronunciationSection = extractNamedSection(englishSection, "Pronunciation", 3);

  if (!pronunciationSection) {
    return {};
  }

  let genericPhonetic: string | undefined;
  let ukPhonetic: string | undefined;
  let usPhonetic: string | undefined;
  let genericAudioUrl: string | undefined;
  let ukAudioUrl: string | undefined;
  let usAudioUrl: string | undefined;

  for (const line of pronunciationSection.split(/\r?\n/)) {
    const inlineAccentHint = extractInlineAccentHint(line);

    for (const match of line.matchAll(/\{\{IPA\|en\|([^{}]+?)\}\}/g)) {
      const { positional, named } = parseTemplateFields(match[1] ?? "");
      const accent = resolveWiktionaryAccentHint(named.get("a") ?? inlineAccentHint);
      const phonetic = positional
        .map((value) => normalizePhoneticText(value))
        .find((value): value is string => Boolean(value));

      if (!phonetic) {
        continue;
      }

      if (accent === "en-GB") {
        ukPhonetic ??= phonetic;
      } else if (accent === "en-US") {
        usPhonetic ??= phonetic;
      } else {
        genericPhonetic ??= phonetic;
      }
    }

    for (const match of line.matchAll(/\{\{audio(?:-IPA)?\|en\|([^{}]+?)\}\}/g)) {
      const { positional, named } = parseTemplateFields(match[1] ?? "");
      const fileName = positional[0]?.trim();

      if (!fileName) {
        continue;
      }

      const accent = resolveWiktionaryAccentHint(
        named.get("a") ?? positional.slice(1).join(", ") ?? inlineAccentHint,
      );
      const audioUrl = toWikimediaFileUrl(fileName);

      if (accent === "en-GB") {
        ukAudioUrl ??= audioUrl;
      } else if (accent === "en-US") {
        usAudioUrl ??= audioUrl;
      } else {
        genericAudioUrl ??= audioUrl;
      }
    }
  }

  return {
    ukPhonetic: ukPhonetic ?? genericPhonetic,
    usPhonetic: usPhonetic ?? genericPhonetic,
    ukAudioUrl: ukAudioUrl ?? genericAudioUrl,
    usAudioUrl: usAudioUrl ?? genericAudioUrl,
  };
}

function buildKaikkiJsonlUrl(query: string): string {
  const normalized = query.trim().toLowerCase();

  return `${KAIKKI_JSONL_BASE_URL}/${encodeURIComponent(normalized.slice(0, 1))}/${encodeURIComponent(normalized.slice(0, 2))}/${encodeURIComponent(normalized)}.jsonl`;
}

function pickKaikkiAudioUrl(sound: KaikkiSoundLike): string | undefined {
  if (typeof sound.mp3_url === "string" && sound.mp3_url.trim()) {
    return sound.mp3_url.trim();
  }

  if (typeof sound.ogg_url === "string" && sound.ogg_url.trim()) {
    return sound.ogg_url.trim();
  }

  if (typeof sound.audio === "string" && sound.audio.trim()) {
    return toWikimediaFileUrl(sound.audio);
  }

  return undefined;
}

export function extractPronunciationFromKaikkiJsonl(raw: string): PronunciationData {
  let genericPhonetic: string | undefined;
  let ukPhonetic: string | undefined;
  let usPhonetic: string | undefined;
  let genericAudioUrl: string | undefined;
  let ukAudioUrl: string | undefined;
  let usAudioUrl: string | undefined;

  for (const line of raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    let entry: KaikkiEntryLike | null = null;

    try {
      entry = JSON.parse(line) as KaikkiEntryLike;
    } catch {
      entry = null;
    }

    const sounds = Array.isArray(entry?.sounds) ? entry.sounds : [];

    for (const sound of sounds) {
      const accent = resolveWiktionaryAccentHint(Array.isArray(sound.tags) ? sound.tags.join(", ") : undefined);
      const phonetic = normalizePhoneticText(typeof sound.ipa === "string" ? sound.ipa : undefined);
      const audioUrl = pickKaikkiAudioUrl(sound);

      if (phonetic) {
        if (accent === "en-GB") {
          ukPhonetic ??= phonetic;
        } else if (accent === "en-US") {
          usPhonetic ??= phonetic;
        } else {
          genericPhonetic ??= phonetic;
        }
      }

      if (audioUrl) {
        if (accent === "en-GB") {
          ukAudioUrl ??= audioUrl;
        } else if (accent === "en-US") {
          usAudioUrl ??= audioUrl;
        } else {
          genericAudioUrl ??= audioUrl;
        }
      }
    }
  }

  return {
    ukPhonetic: ukPhonetic ?? genericPhonetic,
    usPhonetic: usPhonetic ?? genericPhonetic,
    ukAudioUrl: ukAudioUrl ?? genericAudioUrl,
    usAudioUrl: usAudioUrl ?? genericAudioUrl,
  };
}

function parseArpabetToken(token: string): {
  phoneme: string;
  stress?: string;
} {
  const match = token.trim().toUpperCase().match(/^([A-Z]+)([012])?$/);

  if (!match) {
    return { phoneme: token.trim().toUpperCase() };
  }

  return {
    phoneme: match[1] ?? "",
    stress: match[2],
  };
}

function isCmudictVowel(token: string): boolean {
  return CMUDICT_VOWELS.has(parseArpabetToken(token).phoneme);
}

function isLegalCmudictOnset(cluster: string[]): boolean {
  if (!cluster.length) {
    return true;
  }

  const normalized = cluster.map((token) => parseArpabetToken(token).phoneme);

  if (normalized.length === 1) {
    return CMUDICT_SINGLE_ONSETS.has(normalized[0] ?? "");
  }

  return CMUDICT_COMPLEX_ONSETS.has(normalized.join(" "));
}

function splitCmudictCluster(cluster: string[]): {
  coda: string[];
  onset: string[];
} {
  for (let onsetLength = Math.min(3, cluster.length); onsetLength >= 0; onsetLength -= 1) {
    const onset = cluster.slice(cluster.length - onsetLength);

    if (isLegalCmudictOnset(onset)) {
      return {
        coda: cluster.slice(0, cluster.length - onsetLength),
        onset,
      };
    }
  }

  return {
    coda: cluster,
    onset: [],
  };
}

function toCmudictIpaPhoneme(token: string): string | undefined {
  const { phoneme, stress } = parseArpabetToken(token);

  if (phoneme === "AH") {
    return stress === "0" ? "ə" : "ʌ";
  }

  if (phoneme === "AX") {
    return "ə";
  }

  if (phoneme === "AXR") {
    return "ɚ";
  }

  if (phoneme === "ER") {
    return stress === "0" ? "ɚ" : "ɝ";
  }

  if (phoneme === "IX") {
    return "ɨ";
  }

  if (phoneme === "UX") {
    return "ʉ";
  }

  return CMUDICT_IPA_MAP.get(phoneme);
}

function arpabetToIpa(value: string): string | undefined {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const vowelIndices = tokens
    .map((token, index) => (isCmudictVowel(token) ? index : -1))
    .filter((index) => index >= 0);

  if (!tokens.length || !vowelIndices.length) {
    return undefined;
  }

  const syllables: Array<{
    stress?: string;
    tokens: string[];
  }> = [];
  let onset = tokens.slice(0, vowelIndices[0]);

  vowelIndices.forEach((vowelIndex, index) => {
    const nextVowelIndex = vowelIndices[index + 1];
    const between = nextVowelIndex === undefined
      ? tokens.slice(vowelIndex + 1)
      : tokens.slice(vowelIndex + 1, nextVowelIndex);

    let coda = between;
    let nextOnset: string[] = [];

    if (nextVowelIndex !== undefined) {
      const split = splitCmudictCluster(between);
      coda = split.coda;
      nextOnset = split.onset;
    }

    syllables.push({
      stress: parseArpabetToken(tokens[vowelIndex] ?? "").stress,
      tokens: [...onset, tokens[vowelIndex] ?? "", ...coda],
    });

    onset = nextOnset;
  });

  const ipa = syllables.map((syllable) => {
    const stressMarker = syllable.stress === "1"
      ? "ˈ"
      : syllable.stress === "2"
        ? "ˌ"
        : "";
    const body = syllable.tokens
      .map((token) => toCmudictIpaPhoneme(token))
      .filter((token): token is string => Boolean(token))
      .join("");

    return `${stressMarker}${body}`;
  }).join("");

  return ipa || undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractPronunciationFromCmudictText(raw: string, query: string): PronunciationData {
  const match = raw.match(new RegExp(`^${escapeRegex(query.toLowerCase())}(?:\\(\\d+\\))?\\s+(.+)$`, "m"));
  const usPhonetic = normalizePhoneticText(arpabetToIpa(match?.[1] ?? ""));

  return usPhonetic ? { usPhonetic } : {};
}

async function fetchWithTimeout(
  fetchFn: FetchLike,
  input: string,
  timeoutMs = PRONUNCIATION_REQUEST_TIMEOUT_MS,
): Promise<Awaited<ReturnType<FetchLike>> | null> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchFn(input, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function lookupDictionaryApiPronunciation(
  query: string,
  fetchFn: FetchLike,
): Promise<PronunciationData | null> {
  const response = await fetchWithTimeout(
    fetchFn,
    `${DICTIONARY_API_BASE_URL}/${encodeURIComponent(query)}`,
  );

  if (!response?.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);

  if (!Array.isArray(payload)) {
    return null;
  }

  const result = extractBestPronunciationEntry(payload as DictionaryEntryLike[]);

  return hasPronunciationData(result) ? result : null;
}

async function lookupKaikkiPronunciation(
  query: string,
  fetchFn: FetchLike,
): Promise<PronunciationData | null> {
  const response = await fetchWithTimeout(
    fetchFn,
    buildKaikkiJsonlUrl(query),
  );

  if (!response?.ok) {
    return null;
  }

  const raw = await response.text().catch(() => "");

  if (!raw.trim()) {
    return null;
  }

  const result = extractPronunciationFromKaikkiJsonl(raw);

  return hasPronunciationData(result) ? result : null;
}

async function lookupWiktionaryPronunciation(
  query: string,
  fetchFn: FetchLike,
): Promise<PronunciationData | null> {
  const response = await fetchWithTimeout(
    fetchFn,
    `${WIKTIONARY_RAW_PAGE_URL}${encodeURIComponent(query)}`,
  );

  if (!response?.ok) {
    return null;
  }

  const raw = await response.text().catch(() => "");

  if (!raw.trim()) {
    return null;
  }

  const result = extractPronunciationFromWiktionaryRaw(raw);

  return hasPronunciationData(result) ? result : null;
}

async function loadCmudictText(fetchFn: FetchLike): Promise<string | null> {
  if (fetchFn === fetch) {
    cmudictTextPromise ??= (async () => {
      for (const url of CMUDICT_SOURCE_URLS) {
        const response = await fetchWithTimeout(fetchFn, url, CMUDICT_REQUEST_TIMEOUT_MS);

        if (!response?.ok) {
          continue;
        }

        const raw = await response.text().catch(() => "");

        if (raw.trim()) {
          return raw;
        }
      }

      return null;
    })();

    return cmudictTextPromise;
  }

  for (const url of CMUDICT_SOURCE_URLS) {
    const response = await fetchWithTimeout(fetchFn, url, CMUDICT_REQUEST_TIMEOUT_MS);

    if (!response?.ok) {
      continue;
    }

    const raw = await response.text().catch(() => "");

    if (raw.trim()) {
      return raw;
    }
  }

  return null;
}

async function lookupCmudictPronunciation(
  query: string,
  fetchFn: FetchLike,
): Promise<PronunciationData | null> {
  if (fetchFn === fetch && cmudictLookupCache.has(query)) {
    const cached = cmudictLookupCache.get(query);
    return cached ? { usPhonetic: cached } : null;
  }

  const raw = await loadCmudictText(fetchFn);

  if (!raw) {
    if (fetchFn === fetch) {
      cmudictLookupCache.set(query, null);
    }

    return null;
  }

  const result = extractPronunciationFromCmudictText(raw, query);

  if (fetchFn === fetch) {
    cmudictLookupCache.set(query, result.usPhonetic ?? null);
  }

  return hasPhoneticData(result) ? result : null;
}

interface PronunciationLookupHit {
  candidateIndex: number;
  query: string;
  result: PronunciationData;
}

function pickBetterPronunciationHit(
  left: PronunciationLookupHit | null,
  right: PronunciationLookupHit | null,
): PronunciationLookupHit | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftScore = getPronunciationStrength(left.result) * 10 - left.candidateIndex;
  const rightScore = getPronunciationStrength(right.result) * 10 - right.candidateIndex;

  return rightScore > leftScore ? right : left;
}

export async function lookupBestPronunciation(
  surface: string,
  fetchFn: FetchLike = fetch,
): Promise<PronunciationData> {
  const candidates = buildPronunciationCandidates(surface);

  if (!candidates.length) {
    return {};
  }

  const dictionaryHits = (await Promise.all(candidates.map(async (query, candidateIndex) => {
    const result = await lookupDictionaryApiPronunciation(query, fetchFn);

    return result
      ? {
        candidateIndex,
        query,
        result,
      }
      : null;
  }))).filter((item): item is PronunciationLookupHit => Boolean(item));

  let bestDictionary: PronunciationLookupHit | null = null;

  for (const hit of dictionaryHits) {
    bestDictionary = pickBetterPronunciationHit(bestDictionary, hit);
  }

  if (bestDictionary && hasPhoneticData(bestDictionary.result)) {
    const kaikkiResult = await lookupKaikkiPronunciation(bestDictionary.query, fetchFn);
    const withKaikki = kaikkiResult
      ? mergePronunciationData(bestDictionary.result, kaikkiResult)
      : bestDictionary.result;
    const wiktionaryResult = await lookupWiktionaryPronunciation(bestDictionary.query, fetchFn);

    return wiktionaryResult
      ? mergePronunciationData(withKaikki, wiktionaryResult)
      : withKaikki;
  }

  const kaikkiHits = (await Promise.all(candidates.map(async (query, candidateIndex) => {
    const result = await lookupKaikkiPronunciation(query, fetchFn);

    return result
      ? {
        candidateIndex,
        query,
        result,
      }
      : null;
  }))).filter((item): item is PronunciationLookupHit => Boolean(item));

  const wiktionaryHits = (await Promise.all(candidates.map(async (query, candidateIndex) => {
    const result = await lookupWiktionaryPronunciation(query, fetchFn);

    return result
      ? {
        candidateIndex,
        query,
        result,
      }
      : null;
  }))).filter((item): item is PronunciationLookupHit => Boolean(item));

  let bestResult = bestDictionary;

  for (const hit of kaikkiHits) {
    bestResult = pickBetterPronunciationHit(bestResult, hit);
  }

  for (const hit of wiktionaryHits) {
    if (bestResult && hit.query === bestResult.query) {
      bestResult = {
        ...bestResult,
        result: mergePronunciationData(bestResult.result, hit.result),
      };
      continue;
    }

    bestResult = pickBetterPronunciationHit(bestResult, hit);
  }

  if (bestResult && hasPhoneticData(bestResult.result)) {
    return bestResult.result;
  }

  const cmudictHits = (await Promise.all(candidates.map(async (query, candidateIndex) => {
    const result = await lookupCmudictPronunciation(query, fetchFn);

    return result
      ? {
        candidateIndex,
        query,
        result,
      }
      : null;
  }))).filter((item): item is PronunciationLookupHit => Boolean(item));

  for (const hit of cmudictHits) {
    if (bestResult && hit.query === bestResult.query) {
      bestResult = {
        ...bestResult,
        result: mergePronunciationData(bestResult.result, hit.result),
      };
      continue;
    }

    bestResult = pickBetterPronunciationHit(bestResult, hit);
  }

  return bestResult?.result ?? {};
}

export function hasEnglishVoice(voices: TtsVoiceLike[]): boolean {
  return voices.some(isEnglishVoice);
}

export function selectVoiceForAccent(
  voices: TtsVoiceLike[],
  accent: PronunciationAccent,
): TtsVoiceLike | null {
  const englishVoices = voices.filter((voice) => isEnglishVoice(voice) && matchesAccent(voice, accent));

  if (!englishVoices.length) {
    return null;
  }

  return [...englishVoices].sort((left, right) => scoreVoice(right, accent) - scoreVoice(left, accent))[0] ?? null;
}
