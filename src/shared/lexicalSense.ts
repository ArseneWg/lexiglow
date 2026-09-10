import { resolveMasteryIdentity } from "./lexicon";
import { getLemmaCandidates } from "./normalize";
import type { AlternativeMeaning, SupportedLearnerLanguageCode } from "./types";

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
  learnerLanguageCode?: SupportedLearnerLanguageCode;
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

function inferFormOfLemma(entries: readonly KaikkiEntryLike[]): string | undefined {
  for (const entry of entries) {
    for (const sense of entry.senses || []) {
      const formOf = sense.form_of?.find((item) => item.word?.trim())?.word?.trim();
      if (formOf) return normalizeSurface(formOf);
    }
  }
  return undefined;
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

function masteryIdentityNote(
  surface: string,
  lemma: string,
  learnerLanguageCode?: SupportedLearnerLanguageCode,
): string | undefined {
  const identity = resolveMasteryIdentity(surface, lemma);
  const code = learnerLanguageCode || "en";
  const components = identity.components?.join(" + ") || "";

  const messages = {
    shared: {
      "zh-CN": `学习状态与 ${identity.masteryKey} 共享`,
      "zh-TW": `學習狀態與 ${identity.masteryKey} 共用`,
      ja: `${identity.masteryKey} と学習状態を共有`,
      ko: `${identity.masteryKey}와 학습 상태 공유`,
      fr: `statut d’apprentissage partagé avec ${identity.masteryKey}`,
      de: `Lernstatus mit ${identity.masteryKey} geteilt`,
      es: `estado de aprendizaje compartido con ${identity.masteryKey}`,
      "pt-BR": `status de aprendizagem compartilhado com ${identity.masteryKey}`,
      ru: `статус изучения общий с ${identity.masteryKey}`,
      it: `stato di apprendimento condiviso con ${identity.masteryKey}`,
      tr: `öğrenme durumu ${identity.masteryKey} ile ortak`,
      vi: `trạng thái học dùng chung với ${identity.masteryKey}`,
      id: `status belajar dibagikan dengan ${identity.masteryKey}`,
      th: `ใช้สถานะการเรียนรู้ร่วมกับ ${identity.masteryKey}`,
      ar: `حالة التعلّم مشتركة مع ${identity.masteryKey}`,
      en: `mastery shared with ${identity.masteryKey}`,
    },
    independent: {
      "zh-CN": `学习状态与 ${identity.lexicalLemma || lemma} 分开记录`,
      "zh-TW": `學習狀態與 ${identity.lexicalLemma || lemma} 分開記錄`,
      ja: `${identity.lexicalLemma || lemma} とは別に学習状態を記録`,
      ko: `${identity.lexicalLemma || lemma}와 학습 상태를 별도로 기록`,
      fr: `statut d’apprentissage séparé de ${identity.lexicalLemma || lemma}`,
      de: `Lernstatus getrennt von ${identity.lexicalLemma || lemma}`,
      es: `estado de aprendizaje separado de ${identity.lexicalLemma || lemma}`,
      "pt-BR": `status de aprendizagem separado de ${identity.lexicalLemma || lemma}`,
      ru: `статус изучения хранится отдельно от ${identity.lexicalLemma || lemma}`,
      it: `stato di apprendimento separato da ${identity.lexicalLemma || lemma}`,
      tr: `öğrenme durumu ${identity.lexicalLemma || lemma} öğesinden ayrı`,
      vi: `trạng thái học được lưu riêng với ${identity.lexicalLemma || lemma}`,
      id: `status belajar dicatat terpisah dari ${identity.lexicalLemma || lemma}`,
      th: `บันทึกสถานะการเรียนรู้แยกจาก ${identity.lexicalLemma || lemma}`,
      ar: `حالة التعلّم منفصلة عن ${identity.lexicalLemma || lemma}`,
      en: `mastery kept separate from ${identity.lexicalLemma || lemma}`,
    },
    compound: {
      "zh-CN": `组成部分：${components} · 学习状态单独记录为 ${identity.masteryKey}`,
      "zh-TW": `組成部分：${components} · 學習狀態單獨記錄為 ${identity.masteryKey}`,
      ja: `構成語: ${components} · 学習状態は ${identity.masteryKey} として個別管理`,
      ko: `구성 요소: ${components} · 학습 상태는 ${identity.masteryKey}로 별도 관리`,
      fr: `composants : ${components} · apprentissage suivi comme ${identity.masteryKey}`,
      de: `Bestandteile: ${components} · Lernstatus separat als ${identity.masteryKey}`,
      es: `componentes: ${components} · aprendizaje registrado como ${identity.masteryKey}`,
      "pt-BR": `componentes: ${components} · aprendizagem registrada como ${identity.masteryKey}`,
      ru: `компоненты: ${components} · статус изучения хранится как ${identity.masteryKey}`,
      it: `componenti: ${components} · apprendimento registrato come ${identity.masteryKey}`,
      tr: `bileşenler: ${components} · öğrenme durumu ${identity.masteryKey} olarak izlenir`,
      vi: `thành phần: ${components} · trạng thái học được lưu dưới ${identity.masteryKey}`,
      id: `komponen: ${components} · status belajar dicatat sebagai ${identity.masteryKey}`,
      th: `องค์ประกอบ: ${components} · บันทึกสถานะการเรียนรู้เป็น ${identity.masteryKey}`,
      ar: `المكوّنات: ${components} · تُسجّل حالة التعلّم باسم ${identity.masteryKey}`,
      en: `components: ${components} · mastery tracked as ${identity.masteryKey}`,
    },
  } as const;

  if (identity.kind === "shared-inflection") {
    return messages.shared[code as keyof typeof messages.shared] || messages.shared.en;
  }
  if (identity.kind === "independent-inflection") {
    return messages.independent[code as keyof typeof messages.independent] || messages.independent.en;
  }
  if (identity.kind === "compound" && components) {
    return messages.compound[code as keyof typeof messages.compound] || messages.compound.en;
  }
  return undefined;
}

export function describeLearningIdentity(
  surface: string,
  lemma: string,
  partOfSpeech?: string,
  learnerLanguageCode?: SupportedLearnerLanguageCode,
): string | undefined {
  const formLabel = describeEnglishWordForm(surface, lemma, partOfSpeech);
  const masteryNote = masteryIdentityNote(surface, lemma, learnerLanguageCode);
  return [formLabel, masteryNote].filter(Boolean).join(" · ") || undefined;
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
  let lemma = normalized ? inferFormOfLemma(exactEntries) : normalized;
  let lemmaEntries: KaikkiEntryLike[] = [];

  if (normalized && !lemma) {
    const candidates = getLemmaCandidates(normalized)
      .filter((candidate) => normalizeSurface(candidate) !== normalized)
      .slice(0, 4);
    for (const candidate of candidates) {
      const candidateEntries = await fetchEntries(candidate, fetchFn);
      if (!candidateEntries.length) continue;
      lemma = normalizeSurface(candidate);
      lemmaEntries = candidateEntries;
      break;
    }
  }

  lemma ||= normalized;
  if (lemma && lemma !== normalized && !lemmaEntries.length) {
    lemmaEntries = await fetchEntries(lemma, fetchFn);
  }

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

  const lexicalPos = options.partOfSpeech
    || exactEntries.find((entry) => normalizePos(entry.pos))?.pos
    || lemmaEntries.find((entry) => normalizePos(entry.pos))?.pos;

  return {
    surface,
    lemma: lemma || normalized,
    wordFormLabel: describeEnglishWordForm(surface, lemma || normalized, lexicalPos),
    learnerLanguageCode: options.learnerLanguageCode,
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

function normalizeLexicalMetadataCacheKeyPart(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildLexicalMetadataCacheKey({
  learnerLanguageCode,
  surface,
  partOfSpeech,
  contextText,
  primaryTranslation,
}: {
  learnerLanguageCode: string;
  surface: string;
  partOfSpeech?: string;
  contextText?: string;
  primaryTranslation?: string;
}): string {
  return [
    learnerLanguageCode,
    normalizeLexicalMetadataCacheKeyPart(surface, 160).toLowerCase(),
    normalizeLexicalMetadataCacheKeyPart(partOfSpeech ?? "", 48).toLowerCase(),
    normalizeLexicalMetadataCacheKeyPart(contextText ?? "", 600),
    normalizeLexicalMetadataCacheKeyPart(primaryTranslation ?? "", 240).toLowerCase(),
  ].join("::");
}

function compactGloss(value: string, limit = 118): string | undefined {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= limit ? compact : compact.slice(0, limit - 1).trimEnd() + "…";
}

export function buildStructuredLexicalMetadata(
  lookup: StructuredLexicalLookup,
  primaryTranslation = "",
): {
  lexicalLemma?: string;
  wordFormLabel?: string;
  contextualPartOfSpeech?: string;
  semanticHint?: string;
  alternativeMeanings?: AlternativeMeaning[];
} {
  const primarySense = lookup.senses[0];
  const normalizedPrimary = primaryTranslation.trim().toLowerCase();
  const seen = new Set<string>(normalizedPrimary ? [normalizedPrimary] : []);
  const alternativeMeanings: AlternativeMeaning[] = [];

  for (const sense of lookup.senses) {
    for (const meaning of sense.targetMeanings || []) {
      const normalized = meaning.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      alternativeMeanings.push({
        meaning,
        partOfSpeech: sense.partOfSpeech,
        semanticHint: compactGloss(sense.gloss, 82),
      });
      if (alternativeMeanings.length >= 3) break;
    }
    if (alternativeMeanings.length >= 3) break;
  }

  return {
    lexicalLemma: lookup.lemma || undefined,
    wordFormLabel: describeLearningIdentity(
      lookup.surface,
      lookup.lemma,
      primarySense?.partOfSpeech,
      lookup.learnerLanguageCode,
    ) || lookup.wordFormLabel,
    contextualPartOfSpeech: primarySense?.partOfSpeech,
    semanticHint: primarySense ? compactGloss(primarySense.gloss) : undefined,
    alternativeMeanings: alternativeMeanings.length ? alternativeMeanings : undefined,
  };
}
