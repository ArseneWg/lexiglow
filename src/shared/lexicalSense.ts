import { getLemmaCandidates } from "./normalize";
import type { SupportedLearnerLanguageCode } from "./types";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  text(): Promise<string>;
}>;

interface KaikkiTranslationLike {
  lang_code?: string;
  code?: string;
  word?: string;
  sense?: string;
  tags?: string[];
}

interface KaikkiSenseLike {
  glosses?: string[];
  raw_glosses?: string[];
  tags?: string[];
  topics?: string[];
  translations?: KaikkiTranslationLike[];
  form_of?: Array<{ word?: string }>;
}

interface KaikkiEntryLike {
  word?: string;
  pos?: string;
  senses?: KaikkiSenseLike[];
  translations?: KaikkiTranslationLike[];
}

export interface StructuredLexicalSense {
  partOfSpeech?: string;
  gloss: string;
  tags?: string[];
  topics?: string[];
  targetMeanings?: string[];
  source: "kaikki";
}

export interface StructuredLexicalLookup {
  surface: string;
  lemma: string;
  wordFormLabel?: string;
  senses: StructuredLexicalSense[];
}

const KAIKKI_TIMEOUT_MS = 1200;
const KAIKKI_BASE_URL = "https://kaikki.org/dictionary/English/meaning";
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in",
  "into", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "was",
  "were", "when", "where", "which", "with", "you", "your", "someone", "something", "one",
]);

function normalizeSurface(value: string): string {
  return value.trim().toLowerCase().replace(/[’]/g, "'");
}

function normalizePos(value?: string): string {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "v." || normalized.startsWith("v") || normalized.includes("verb")) return "verb";
  if (normalized === "n." || normalized.startsWith("n") || normalized.includes("noun")) return "noun";
  if (normalized === "adj." || normalized.startsWith("adj") || normalized.includes("adjective")) return "adjective";
  if (normalized === "adv." || normalized.startsWith("adv") || normalized.includes("adverb")) return "adverb";
  return normalized;
}

function buildKaikkiUrl(surface: string): string {
  const normalized = normalizeSurface(surface);
  return KAIKKI_BASE_URL + "/" + encodeURIComponent(normalized.slice(0, 1)) + "/" +
    encodeURIComponent(normalized.slice(0, 2)) + "/" + encodeURIComponent(normalized) + ".jsonl";
}

async function fetchEntries(surface: string, fetchFn: FetchLike): Promise<KaikkiEntryLike[]> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), KAIKKI_TIMEOUT_MS);
  try {
    const response = await fetchFn(buildKaikkiUrl(surface), { signal: controller.signal });
    if (!response.ok) return [];
    const raw = await response.text().catch(() => "");
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      try {
        const entry = JSON.parse(line) as KaikkiEntryLike;
        return entry?.word && normalizeSurface(entry.word) !== normalizeSurface(surface) ? [] : [entry];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function targetLanguageCodes(code?: SupportedLearnerLanguageCode): Set<string> {
  if (code === "zh-CN" || code === "zh-TW") return new Set(["zh", "cmn"]);
  if (code === "pt-BR") return new Set(["pt"]);
  return new Set(code ? [code.split("-")[0] || code] : []);
}

function collectTargetMeanings(
  translations: readonly KaikkiTranslationLike[] | undefined,
  learnerLanguageCode?: SupportedLearnerLanguageCode,
): string[] {
  const accepted = targetLanguageCodes(learnerLanguageCode);
  if (!accepted.size || !translations?.length) return [];
  const output: string[] = [];
  for (const item of translations) {
    const code = (item.lang_code || item.code || "").toLowerCase();
    const word = item.word?.trim();
    if (!word || !accepted.has(code) || output.includes(word)) continue;
    output.push(word);
    if (output.length >= 3) break;
  }
  return output;
}

function tokens(value: string): Set<string> {
  return new Set((value.toLowerCase().match(/[a-z]+/g) || []).filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function overlapScore(gloss: string, contextText: string): number {
  const glossTokens = tokens(gloss);
  const contextTokens = tokens(contextText);
  let score = 0;
  for (const token of glossTokens) if (contextTokens.has(token)) score += 8;
  return score;
}

function inferLemma(surface: string, entries: readonly KaikkiEntryLike[]): string {
  for (const entry of entries) {
    for (const sense of entry.senses || []) {
      const formOf = sense.form_of?.find((item) => item.word?.trim())?.word?.trim();
      if (formOf) return normalizeSurface(formOf);
    }
  }
  return getLemmaCandidates(surface).find((candidate) => normalizeSurface(candidate) !== normalizeSurface(surface)) || normalizeSurface(surface);
}

export function describeEnglishWordForm(surface: string, lemma: string, partOfSpeech?: string): string | undefined {
  const word = normalizeSurface(surface);
  const base = normalizeSurface(lemma);
  if (!word || !base || word === base) return undefined;
  const pos = normalizePos(partOfSpeech);
  if (word.endsWith("ing")) return pos === "noun" ? "-ing form" : "present participle";
  if (word.endsWith("ed") || word.endsWith("ied") || (base.endsWith("e") && word === base + "d")) return "past / participle";
  if (word.endsWith("est")) return "superlative";
  if (word.endsWith("er")) return "comparative";
  if (word.endsWith("s") || word.endsWith("es") || word.endsWith("ies")) {
    if (pos === "verb") return "3sg";
    if (pos === "noun") return "plural";
    return "-s form";
  }
  return "inflected form";
}

function collectSenses(
  entries: readonly KaikkiEntryLike[],
  contextText: string,
  partOfSpeech: string | undefined,
  learnerLanguageCode: SupportedLearnerLanguageCode | undefined,
): Array<StructuredLexicalSense & { score: number }> {
  const requestedPos = normalizePos(partOfSpeech);
  const output: Array<StructuredLexicalSense & { score: number }> = [];
  for (const entry of entries) {
    const entryPos = normalizePos(entry.pos) || undefined;
    for (const sense of entry.senses || []) {
      if (sense.tags?.includes("form-of") || sense.form_of?.length) continue;
      const gloss = (sense.glosses?.[0] || sense.raw_glosses?.[0] || "").trim();
      if (!gloss) continue;
      const targetMeanings = collectTargetMeanings(
        [...(sense.translations || []), ...(entry.translations || [])],
        learnerLanguageCode,
      );
      let score = overlapScore(gloss, contextText);
      if (requestedPos && entryPos === requestedPos) score += 30;
      if (sense.tags?.some((tag) => /obsolete|archaic|rare|dated/i.test(tag))) score -= 25;
      if (targetMeanings.length) score += 4;
      output.push({
        partOfSpeech: entryPos,
        gloss,
        tags: sense.tags?.slice(0, 4),
        topics: sense.topics?.slice(0, 4),
        targetMeanings: targetMeanings.length ? targetMeanings : undefined,
        source: "kaikki",
        score,
      });
    }
  }
  return output;
}

export async function lookupStructuredLexicalSenses(
  surface: string,
  options: {
    contextText?: string;
    partOfSpeech?: string;
    learnerLanguageCode?: SupportedLearnerLanguageCode;
    fetchFn?: FetchLike;
  } = {},
): Promise<StructuredLexicalLookup> {
  const normalized = normalizeSurface(surface);
  const fetchFn = options.fetchFn || (fetch as unknown as FetchLike);
  const exactEntries = normalized ? await fetchEntries(normalized, fetchFn) : [];
  const lemma = normalized ? inferLemma(normalized, exactEntries) : normalized;
  const lemmaEntries = lemma && lemma !== normalized ? await fetchEntries(lemma, fetchFn) : [];
  const scored = collectSenses(
    [...exactEntries, ...lemmaEntries],
    options.contextText || "",
    options.partOfSpeech,
    options.learnerLanguageCode,
  );
  const seen = new Set<string>();
  const senses = scored
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = [item.partOfSpeech || "", item.gloss.toLowerCase()].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map(({ score: _score, ...sense }) => sense);

  return {
    surface,
    lemma: lemma || normalized,
    wordFormLabel: describeEnglishWordForm(surface, lemma || normalized, options.partOfSpeech),
    senses,
  };
}

export function formatStructuredSensesForPrompt(lookup: StructuredLexicalLookup): string {
  if (!lookup.senses.length) return "(no structured dictionary senses available)";
  return lookup.senses.map((sense, index) => {
    const extras = [
      sense.partOfSpeech ? "pos=" + sense.partOfSpeech : "",
      sense.targetMeanings?.length ? "learner_translations=" + sense.targetMeanings.join(" / ") : "",
      sense.topics?.length ? "topics=" + sense.topics.join(",") : "",
      sense.tags?.length ? "tags=" + sense.tags.join(",") : "",
    ].filter(Boolean).join("; ");
    return "[" + (index + 1) + "] " + sense.gloss + (extras ? " (" + extras + ")" : "");
  }).join("\n");
}
