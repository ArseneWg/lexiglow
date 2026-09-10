import { t } from "./i18n";
import { lookupRank, resolveLookupLemma } from "./lexicon";
import { countTotalKnown, estimateLearnerLevel, resolveWordFlags } from "./settings";
import { createEnglishTokenMatcher } from "./word";
import {
  buildStructuredLexicalMetadata,
  formatStructuredSensesForPrompt,
  lookupStructuredLexicalSenses,
} from "./lexicalSense";
import {
  executeLlmTask,
  getLlmRequestStatus,
  getRuntimeLlmCacheSignature,
  requiresLlmApiKey,
  shouldFallbackToGoogleOnLlmError,
} from "./llm/runtime";
import {
  getDefaultLlmBaseUrl,
  getDefaultLlmModel,
  getLlmProviderDefinition,
  resolveStoredLlmProvider,
} from "./llm/providerRegistry";
import { LlmProviderFormatError } from "./llm/contracts";
import type {
  EnglishExplanationResult,
  LearnerLevelBand,
  SentenceAnalysisResult,
  SentenceClauseBlock,
  SentenceClauseBlockType,
  SentenceHighlight,
  SentenceHighlightCategory,
  SupportedLearnerLanguageCode,
  TranslatorProfile,
  TranslationResult,
  TranslatorSettings,
  TranslatorSettingsState,
  UserSettings,
} from "./types";

export const DEFAULT_TRANSLATOR_SETTINGS: TranslatorSettings = {
  defaultTranslationProvider: "google",
  llmProvider: "openai",
  providerBaseUrl: "https://api.openai.com/v1",
  providerModel: "gpt-5.6-luna",
  apiKey: "",
  fallbackToGoogle: true,
  learnerLanguageCode: "zh-CN",
  llmDisplayMode: "word",
  cacheDurationValue: 30,
  cacheDurationUnit: "minutes",
};

export const DEFAULT_TRANSLATOR_PROFILE: TranslatorProfile = {
  id: "default-profile",
  name: "Default",
  ...DEFAULT_TRANSLATOR_SETTINGS,
};

export const DEFAULT_TRANSLATOR_SETTINGS_STATE: TranslatorSettingsState = {
  activeProfileId: DEFAULT_TRANSLATOR_PROFILE.id,
  profiles: [DEFAULT_TRANSLATOR_PROFILE],
};

export const LEARNER_LANGUAGE_OPTIONS = [
  { code: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文", promptName: "Simplified Chinese" },
  { code: "zh-TW", label: "Chinese (Traditional)", nativeLabel: "繁體中文", promptName: "Traditional Chinese" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", promptName: "Japanese" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", promptName: "Korean" },
  { code: "fr", label: "French", nativeLabel: "Français", promptName: "French" },
  { code: "de", label: "German", nativeLabel: "Deutsch", promptName: "German" },
  { code: "es", label: "Spanish", nativeLabel: "Español", promptName: "Spanish" },
  { code: "pt-BR", label: "Portuguese (Brazil)", nativeLabel: "Português (Brasil)", promptName: "Brazilian Portuguese" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", promptName: "Russian" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", promptName: "Italian" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", promptName: "Turkish" },
  { code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt", promptName: "Vietnamese" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia", promptName: "Indonesian" },
  { code: "th", label: "Thai", nativeLabel: "ไทย", promptName: "Thai" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", promptName: "Arabic" },
] as const satisfies ReadonlyArray<{
  code: SupportedLearnerLanguageCode;
  label: string;
  nativeLabel: string;
  promptName: string;
}>;

const LEARNER_LANGUAGE_MAP = new Map(
  LEARNER_LANGUAGE_OPTIONS.map((option) => [option.code, option]),
);


const WORD_TRANSLATION_REQUEST_TIMEOUT_MS = 8000;
const PRESERVE_PROPER_NAMES_INSTRUCTION =
  "Keep person names, usernames, brand names, and product names in their original English form instead of translating or transliterating them.";

function trimContext(contextText: string): string {
  const compact = contextText.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

export { getDefaultLlmBaseUrl, getDefaultLlmModel };

function resolveLearnerLanguageOption(
  code?: string,
): (typeof LEARNER_LANGUAGE_OPTIONS)[number] {
  return LEARNER_LANGUAGE_MAP.get(code as SupportedLearnerLanguageCode) ?? LEARNER_LANGUAGE_OPTIONS[0];
}

export function getLearnerLanguageLabel(code?: string): string {
  return resolveLearnerLanguageOption(code).label;
}

function getLearnerLanguagePromptLabel(code?: string): string {
  const option = resolveLearnerLanguageOption(code);
  return `${option.promptName} (${option.code})`;
}

function buildMeaningPromptFragment(code?: string): string {
  return `the learner's language, ${getLearnerLanguagePromptLabel(code)}`;
}

function buildEnglishExplanationSystemPrompt(
  settings: TranslatorSettings,
  learnerLevel: LearnerLevelBand,
  knownCount: number,
): string {
  const meaningLanguage = buildMeaningPromptFragment(settings.learnerLanguageCode);

  return (
    `${buildLearnerLevelInstruction(learnerLevel, knownCount)} ` +
    `You explain English words to learners who prefer ${meaningLanguage}. ` +
    `First identify the exact meaning of the target word in ${meaningLanguage}. ` +
    "Then write exactly one short English sentence that explains the word in that context. " +
    "Use simple, common English. Avoid advanced synonyms, long clauses, and dictionary jargon. " +
    "Avoid using the target word or its inflections in the explanation unless absolutely necessary. " +
    'Return strict JSON only: {"meaning":"<precise meaning in the learner language>","explanation":"<one short easy English sentence>"}. No markdown, no extra text.'
  );
}

function buildWordTranslationSystemPrompt(
  settings: TranslatorSettings,
  learnerLevel: LearnerLevelBand,
  knownCount: number,
  mode: TranslatorSettings["llmDisplayMode"],
): string {
  const meaningLanguage = buildMeaningPromptFragment(settings.learnerLanguageCode);

  const senseInstruction =
    "Use the dictionary_senses supplied in the user message as anchors when they fit the sentence, but do not force a listed sense when the context clearly uses a newer technical or domain-specific meaning. " +
    "Choose one exact contextual meaning and return a short semantic hint describing the usage domain or object type. Alternative meanings are handled separately from structured dictionary data; do not enumerate them. ";

  if (mode === "english") {
    return (
      `${buildLearnerLevelInstruction(learnerLevel, knownCount)} ` +
      senseInstruction +
      "Translate the target English word or short phrase based on the sentence context. " +
      `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
      `First identify the exact meaning in ${meaningLanguage}. ` +
      "Then write exactly one short English sentence that explains the word in context. " +
      "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
      "Use simple, common English. Avoid advanced synonyms, long clauses, and dictionary jargon. " +
      "Avoid using the target word or its inflections in the explanation unless absolutely necessary. " +
      'Return strict JSON only: {"word":"<precise meaning in the learner language>","english":"<one short easy English sentence>","pos":"<single best part of speech in context>","hint":"<short usage/domain hint in the learner language>"}. No markdown or extra text.'
    );
  }

  if (mode === "sentence") {
    return (
      senseInstruction +
      "Translate the target English word or short phrase based on the sentence context. " +
      `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
      "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
      `Return strict JSON only: {"word":"<concise meaning in ${meaningLanguage}>","sentence":"<full sentence translation in ${meaningLanguage}>","pos":"<single best part of speech in context>","hint":"<short usage/domain hint in ${meaningLanguage}>"}. No markdown, no explanation.`
    );
  }

  return (
    senseInstruction +
    "Translate the target English word or short phrase based on the sentence context. " +
    `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
    "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
    `Return strict JSON only: {"word":"<concise meaning in ${meaningLanguage}>","pos":"<single best part of speech in context>","hint":"<short usage/domain hint in ${meaningLanguage}>"}. No markdown or extra text.`
  );
}

function buildSelectionTranslationSystemPrompt(settings: TranslatorSettings): string {
  const meaningLanguage = buildMeaningPromptFragment(settings.learnerLanguageCode);

  return (
    `Translate the selected English text into natural ${meaningLanguage}. ` +
    `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
    "If the selected text is a single word or a short phrase, translate that unit precisely based on context. " +
    "If the selected text is a clause or a full sentence, translate the whole selected text completely and naturally. " +
    'Return strict JSON only: {"word":"<translation of the selected text in the learner language>"} with no markdown or extra text.'
  );
}

function buildSentenceAnalysisPrompt(settings: TranslatorSettings): string {
  const meaningLanguage = buildMeaningPromptFragment(settings.learnerLanguageCode);

  return [
    `You are an English sentence analysis tutor for learners who prefer ${meaningLanguage}.`,
    "Your goal is to support accurate translation, not abstract grammar discussion.",
    "Every explanation must show how structure affects meaning and the learner's translation order.",
    PRESERVE_PROPER_NAMES_INSTRUCTION,
    "Keep the wording concrete, useful, and easy to review.",
    "",
    "Return strict compact JSON only with these keys:",
    "translation, structure, analysisSteps, highlights, clauseBlocks",
    "",
    "Field requirements:",
    `1. translation: output one polished ${meaningLanguage} sentence for the whole English sentence. It must be faithful, precise, natural, and suitable for technical reading. Do not translate word by word. Prefer established wording when appropriate.`,
    "2. structure: output one short English backbone sentence with branches removed. Keep only the clause skeleton, not a learner-language explanation. Do not copy the whole original sentence. Do not include sentence-opening adverbs such as presently or currently. Do not keep long modifier chains, relative clauses, subordinate clauses, participial branches, or prepositional detail that is not part of the skeleton. Keep only backbone subject + predicate + object/complement, or at most two backbone clauses if there is true top-level coordination. Keep each backbone clause within about 20 English words. If structure is close to the full sentence, it is wrong.",
    `3. analysisSteps: output exactly 4 ${meaningLanguage} sentences in this order:`,
    "   Step 1: cut the sentence into layers by connectors, punctuation, clauses, coordination, and nonfinite structures.",
    "   Step 2: identify the main clause subject, predicate, object or complement, and state the core meaning.",
    "   Step 3: explain logical groups, clauses, nonfinite phrases, modifiers, and what each part modifies.",
    "   Step 4: explain the learner-language translation order first and then support the final translation.",
    "   Keep each analysis step concise and review-friendly.",
    "4. highlights: output 3 to 8 objects {category,tokenIndex}. Allowed categories are [subject,predicate,nonfinite,conjunction,relative,preposition]. tokenIndex must point to the exact supplied token occurrence. Do not return the token text; LexiGlow derives it from tokenIndex. Prefer the subject head and main predicate plus genuinely useful grammar markers.",
    "5. clauseBlocks: output 1 to 10 objects {type,startToken,endToken}. Allowed types are [main,relative,subordinate,nonfinite,parallel,modifier]. Ranges are inclusive, must be in source order, must start at token 0, must end at the final token, and must cover every supplied token exactly once with no gap or overlap. Do not copy source text; LexiGlow reconstructs exact text from the token ranges.",
    "",
    "Final rules:",
    "The four steps must serve translation, avoid empty jargon, and focus on how structure changes understanding and translation order.",
    "The output must be valid JSON parsable by JSON.parse.",
    "Do not include markdown fences.",
    "Do not include any commentary outside the JSON object.",
  ].join("\n");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Translation request timed out.");
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function cleanModelOutput(text: string): string {
  return text.trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

function getLlmProviderTag(): string {
  return "llm";
}

export function getLlmCacheSignature(settings: Pick<TranslatorSettings, "llmProvider" | "providerBaseUrl" | "providerModel" | "learnerLanguageCode">): string {
  return getRuntimeLlmCacheSignature(settings);
}

class TranslatorFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslatorFallbackError";
  }
}

function firstString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseGoogleTranslateResponse(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return "";
  }

  const segments = payload[0]
    .map((segment) => (Array.isArray(segment) ? firstString(segment[0]) : ""))
    .filter(Boolean);

  return segments.join("").trim();
}

const DICTIONARY_POS_LABELS: Record<string, string> = {
  noun: "n.",
  verb: "v.",
  adjective: "adj.",
  adverb: "adv.",
  pronoun: "pron.",
  preposition: "prep.",
  conjunction: "conj.",
  interjection: "int.",
  determiner: "det.",
  article: "art.",
  abbreviation: "abbr.",
  auxiliary: "aux.",
  "auxiliary verb": "aux.",
  "modal verb": "modal.",
  numeral: "num.",
  number: "num.",
  phrase: "phr.",
};

const CONTEXTUAL_POS_LABELS: Record<string, string> = {
  noun: "n.",
  "n.": "n.",
  gerund: "v.",
  verb: "v.",
  "v.": "v.",
  infinitive: "v.",
  participle: "v.",
  "present participle": "v.",
  "past participle": "v.",
  adjective: "adj.",
  "adj.": "adj.",
  adverb: "adv.",
  "adv.": "adv.",
  pronoun: "pron.",
  "pron.": "pron.",
  preposition: "prep.",
  "prep.": "prep.",
  conjunction: "conj.",
  "conj.": "conj.",
  determiner: "det.",
  "det.": "det.",
  auxiliary: "aux.",
  "aux.": "aux.",
  phrase: "phr.",
  "phr.": "phr.",
};

const inFlightPartOfSpeech = new Map<string, Promise<string | undefined>>();
const cachedPartOfSpeech = new Map<string, string | null>();
const DICTIONARY_PART_OF_SPEECH_TIMEOUT_MS = 1200;

function formatDictionaryPartOfSpeechLabel(value: string): string | undefined {
  return DICTIONARY_POS_LABELS[value.trim().toLowerCase()];
}

function normalizeContextualPartOfSpeech(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  const direct = CONTEXTUAL_POS_LABELS[normalized];

  if (direct) {
    return direct;
  }

  const compact = normalized
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) {
    return undefined;
  }

  return CONTEXTUAL_POS_LABELS[compact];
}

export function summarizeDictionaryPartOfSpeech(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }

  const labels: string[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const meanings = (entry as { meanings?: unknown }).meanings;

    if (!Array.isArray(meanings)) {
      continue;
    }

    for (const meaning of meanings) {
      if (!meaning || typeof meaning !== "object") {
        continue;
      }

      const raw = (meaning as { partOfSpeech?: unknown }).partOfSpeech;

      if (typeof raw !== "string") {
        continue;
      }

      const label = formatDictionaryPartOfSpeechLabel(raw);

      if (!label || labels.includes(label)) {
        continue;
      }

      labels.push(label);

      if (labels.length >= 2) {
        return labels.join(" / ");
      }
    }
  }

  return labels.length ? labels.join(" / ") : undefined;
}

export async function lookupDictionaryPartOfSpeech({
  lemma,
  surface,
}: {
  lemma: string;
  surface: string;
}): Promise<string | undefined> {
  const query = (lemma || surface).trim().toLowerCase();

  if (!query || /\s/.test(query)) {
    return undefined;
  }

  const cached = cachedPartOfSpeech.get(query);

  if (cached !== undefined) {
    return cached ?? undefined;
  }

  let pending = inFlightPartOfSpeech.get(query);

  if (!pending) {
    pending = (async () => {
      const controller = new AbortController();
      const timeoutId = globalThis.setTimeout(() => {
        controller.abort();
      }, DICTIONARY_PART_OF_SPEECH_TIMEOUT_MS);

      try {
        const response = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          cachedPartOfSpeech.set(query, null);
          return undefined;
        }

        const payload = (await response.json().catch(() => null)) as unknown;
        const label = summarizeDictionaryPartOfSpeech(payload);
        cachedPartOfSpeech.set(query, label ?? null);
        return label;
      } catch {
        return undefined;
      } finally {
        globalThis.clearTimeout(timeoutId);
        inFlightPartOfSpeech.delete(query);
      }
    })();

    inFlightPartOfSpeech.set(query, pending);
  }

  return pending;
}

export function parseLlmTranslationResponse(payload: string): {
  translation: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
  contextualPartOfSpeech?: string;
  semanticHint?: string;
} {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
        word?: unknown;
        sentence?: unknown;
        english?: unknown;
        pos?: unknown;
        hint?: unknown;
      };
      const translation = cleanModelOutput(typeof parsed.word === "string" ? parsed.word : "");
      const sentenceTranslation = cleanModelOutput(
        typeof parsed.sentence === "string" ? parsed.sentence : "",
      );
      const englishExplanation = cleanModelOutput(
        typeof parsed.english === "string" ? parsed.english : "",
      );
      const contextualPartOfSpeech = normalizeContextualPartOfSpeech(
        typeof parsed.pos === "string" ? parsed.pos : "",
      );
      const semanticHint = cleanModelOutput(typeof parsed.hint === "string" ? parsed.hint : "");
      if (translation) {
        return {
          translation,
          sentenceTranslation: sentenceTranslation || undefined,
          englishExplanation: englishExplanation || undefined,
          contextualPartOfSpeech,
          semanticHint: semanticHint || undefined,
        };
      }
    } catch {
      // Fall back to plain-text parsing below.
    }
  }

  return {
    translation: cleanModelOutput(content),
  };
}

export function parseEnglishExplanationResponse(payload: string): {
  meaning: string;
  explanation: string;
} {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("English explanation response was not valid JSON.");
  }

  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
    meaning?: unknown;
    explanation?: unknown;
  };

  const meaning = cleanModelOutput(typeof parsed.meaning === "string" ? parsed.meaning : "");
  const explanation = cleanModelOutput(
    typeof parsed.explanation === "string" ? parsed.explanation : "",
  );

  if (!meaning || !explanation) {
    throw new Error("English explanation response was incomplete.");
  }

  return { meaning, explanation };
}

const HIGHLIGHT_CATEGORIES = new Set<SentenceHighlightCategory>([
  "subject",
  "predicate",
  "nonfinite",
  "conjunction",
  "relative",
  "preposition",
]);

const ANALYSIS_PLAIN_PREPOSITIONS = new Set([
  "in", "on", "at", "for", "with", "by", "to", "from", "of", "about", "over",
  "under", "after", "before", "during", "through", "between", "against", "into",
  "without", "within", "across",
]);


export class SentenceAnalysisFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentenceAnalysisFormatError";
  }
}

class SentenceAnalysisRequestError extends Error {
  status?: number;
  responseText?: string;
  stage?: string;
  retryable: boolean;

  constructor(message: string, options?: { status?: number; responseText?: string; stage?: string; retryable?: boolean }) {
    super(message);
    this.name = "SentenceAnalysisRequestError";
    this.status = options?.status;
    this.responseText = options?.responseText;
    this.stage = options?.stage;
    this.retryable = options?.retryable ?? false;
  }
}

function logSentenceAnalysisDebug(event: string, detail: Record<string, unknown>) {
  console.warn("[LexiGlow][sentence-analysis]", event, detail);
}

const CLAUSE_BLOCK_TYPES = new Set<SentenceClauseBlockType>([
  "main",
  "relative",
  "subordinate",
  "nonfinite",
  "parallel",
  "modifier",
]);

interface AnalysisToken { index: number; text: string; start: number; end: number }

function tokenizeSentenceForAnalysis(sentence: string): AnalysisToken[] {
  const tokens: AnalysisToken[] = [];
  const matcher = createEnglishTokenMatcher();
  let match = matcher.exec(sentence);
  let index = 0;
  while (match) {
    tokens.push({ index, text: match[0], start: match.index, end: match.index + match[0].length });
    index += 1;
    match = matcher.exec(sentence);
  }
  return tokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSentenceHighlightRanges(
  value: unknown,
  tokens: AnalysisToken[],
): SentenceHighlight[] {
  if (!Array.isArray(value)) throw new SentenceAnalysisFormatError("highlights must be an array.");
  return value.map((item, index) => {
    if (!isRecord(item) || !HIGHLIGHT_CATEGORIES.has(item.category as SentenceHighlightCategory)) {
      throw new SentenceAnalysisFormatError(`highlight ${index + 1} has an invalid category.`);
    }
    if (!Number.isInteger(item.tokenIndex)) {
      throw new SentenceAnalysisFormatError(`highlight ${index + 1} is missing a valid tokenIndex.`);
    }
    const token = tokens[item.tokenIndex as number];
    if (!token) throw new SentenceAnalysisFormatError(`highlight ${index + 1} points outside the source tokens.`);
    const category = item.category as SentenceHighlightCategory;
    if (category === "preposition" && !ANALYSIS_PLAIN_PREPOSITIONS.has(token.text.toLowerCase())) {
      throw new SentenceAnalysisFormatError(`highlight ${index + 1} marks a non-preposition as a preposition.`);
    }
    return { category, text: token.text, tokenIndex: token.index, start: token.start, end: token.end };
  });
}

function parseSentenceClauseRanges(
  value: unknown,
  tokens: AnalysisToken[],
  sentence: string,
): SentenceClauseBlock[] {
  if (!Array.isArray(value) || !value.length) {
    throw new SentenceAnalysisFormatError("clauseBlocks must contain token ranges.");
  }
  if (!tokens.length) throw new SentenceAnalysisFormatError("The source sentence has no analyzable tokens.");

  const ranges = value.map((item, index) => {
    if (!isRecord(item) || !CLAUSE_BLOCK_TYPES.has(item.type as SentenceClauseBlockType)) {
      throw new SentenceAnalysisFormatError(`clause block ${index + 1} has an invalid type.`);
    }
    const startToken = item.startToken;
    const endToken = item.endToken;
    if (!Number.isInteger(startToken) || !Number.isInteger(endToken)) {
      throw new SentenceAnalysisFormatError(`clause block ${index + 1} must use integer token ranges.`);
    }
    const start = startToken as number;
    const end = endToken as number;
    if (start < 0 || end < start || end >= tokens.length) {
      throw new SentenceAnalysisFormatError(`clause block ${index + 1} points outside the source tokens.`);
    }
    return { type: item.type as SentenceClauseBlockType, startToken: start, endToken: end };
  });

  if (ranges[0]?.startToken !== 0) {
    throw new SentenceAnalysisFormatError("clauseBlocks must start at token 0.");
  }
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].startToken !== ranges[index - 1].endToken + 1) {
      throw new SentenceAnalysisFormatError(
        `clauseBlocks have a gap or overlap between tokens ${ranges[index - 1].endToken} and ${ranges[index].startToken}.`,
      );
    }
  }
  if (ranges.at(-1)?.endToken !== tokens.length - 1) {
    throw new SentenceAnalysisFormatError(`clauseBlocks must end at token ${tokens.length - 1}.`);
  }

  return ranges.map((range, index) => {
    const startChar = index === 0 ? 0 : tokens[range.startToken].start;
    const nextRange = ranges[index + 1];
    const endChar = nextRange ? tokens[nextRange.startToken].start : sentence.length;
    return {
      type: range.type,
      startToken: range.startToken,
      endToken: range.endToken,
      text: sentence.slice(startChar, endChar).trim(),
    };
  });
}

export function parseSentenceAnalysisResponse(
  payload: string,
  sentence: string,
): Omit<SentenceAnalysisResult, "provider" | "cached"> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(payload)) as Record<string, unknown>;
  } catch {
    throw new SentenceAnalysisFormatError("Sentence analysis response was not valid JSON.");
  }
  const translation = cleanModelOutput(typeof parsed.translation === "string" ? parsed.translation : "");
  const structure = cleanModelOutput(typeof parsed.structure === "string" ? parsed.structure : "");
  const analysisSteps = Array.isArray(parsed.analysisSteps)
    ? parsed.analysisSteps.map((item) => cleanModelOutput(String(item))).filter(Boolean)
    : [];
  if (!translation || !structure || analysisSteps.length !== 4) {
    throw new SentenceAnalysisFormatError("Sentence analysis response was incomplete.");
  }
  const tokens = tokenizeSentenceForAnalysis(sentence);
  return {
    translation,
    structure,
    analysisSteps,
    highlights: parseSentenceHighlightRanges(parsed.highlights, tokens),
    clauseBlocks: parseSentenceClauseRanges(parsed.clauseBlocks, tokens, sentence),
  };
}

function sentenceAnalysisValidationErrors(
  result: Omit<SentenceAnalysisResult, "provider" | "cached">,
  sentence: string,
): string[] {
  const wordCount = tokenizeSentenceForAnalysis(sentence).length;
  const minHighlights = wordCount <= 8 ? 1 : wordCount <= 16 ? 2 : 3;
  const minBlocks = wordCount <= 8 ? 1 : 2;
  const errors: string[] = [];
  if (result.highlights.length < minHighlights) {
    errors.push(`expected at least ${minHighlights} useful grammar highlights; got ${result.highlights.length}`);
  }
  if (result.clauseBlocks.length < minBlocks) {
    errors.push(`expected at least ${minBlocks} clause blocks; got ${result.clauseBlocks.length}`);
  }
  const categories = new Set(result.highlights.map((item) => item.category));
  if (wordCount > 12 && categories.size < 2) {
    errors.push("long sentences must identify at least two grammar highlight categories");
  }
  return errors;
}

function shouldRetrySentenceAnalysisError(error: unknown): boolean {
  return error instanceof SentenceAnalysisRequestError && error.retryable;
}

async function requestSentenceAnalysis({
  settings,
  sentence,
  systemPrompt,
  qualityRetry = false,
  retryFeedback = [],
}: {
  settings: TranslatorSettings;
  sentence: string;
  systemPrompt: string;
  qualityRetry?: boolean;
  retryFeedback?: string[];
}): Promise<Omit<SentenceAnalysisResult, "provider" | "cached">> {
  const tokens = tokenizeSentenceForAnalysis(sentence);
  const tokenList = tokens.map((token) => `${token.index}:${token.text}`).join(" ");
  const retryInstruction = qualityRetry
    ? `
quality_retry: The previous attempt failed validation. Fix every issue below and return one complete JSON object.
${retryFeedback.map((item) => `- ${item}`).join("\n")}
Use only tokenIndex/startToken/endToken values from the supplied token list. Do not copy source text into highlights or clauseBlocks.`
    : "";
  let llmResult: Awaited<ReturnType<typeof executeLlmTask>>;
  try {
    llmResult = await executeLlmTask({
      settings,
      task: "sentence-analysis",
      systemPrompt,
      userPrompt: `sentence: ${sentence}
tokens: ${tokenList}${retryInstruction}`,
      sourceText: sentence,
      qualityRetry,
    });
  } catch (error) {
    throw new SentenceAnalysisRequestError(
      error instanceof Error ? error.message : "LLM analysis request failed.",
      {
        status: getLlmRequestStatus(error) || undefined,
        responseText: "",
        stage: qualityRetry ? "quality-retry" : "single-shot",
        retryable: error instanceof LlmProviderFormatError,
      },
    );
  }

  try {
    return parseSentenceAnalysisResponse(llmResult.content, sentence);
  } catch (error) {
    throw new SentenceAnalysisRequestError(
      error instanceof Error ? error.message : "Sentence analysis parsing failed.",
      {
        status: llmResult.response.status,
        responseText: llmResult.content.slice(0, 1600),
        stage: qualityRetry ? "quality-retry" : "single-shot",
        retryable: true,
      },
    );
  }
}

function buildLearnerLevelInstruction(level: LearnerLevelBand, knownCount: number): string {
  const ceilings: Record<LearnerLevelBand, string> = {
    A1: "very short A1 English, about top 1500 common words",
    A2: "short A2 English, mostly within top 3000 common words",
    B1: "plain B1 English, mostly within top 5000 common words",
    B2: "clear B2 English, avoid academic wording",
    C1: "clear but still simple English, avoid unnecessary hard words",
  };

  return `The learner likely knows about ${knownCount} English words, roughly ${level}. Write the explanation in ${ceilings[level]}.`;
}

function explanationUnknownWordBudget(level: LearnerLevelBand): number {
  switch (level) {
    case "A1":
    case "A2":
      return 0;
    case "B1":
      return 1;
    case "B2":
    case "C1":
      return 2;
  }
}

function explanationNeedsSimplifying(
  explanation: string,
  targetLemma: string,
  settings: UserSettings,
): boolean {
  const tokens = explanation.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];

  if (!tokens.length) {
    return true;
  }

  let unknownCount = 0;
  let countedWords = 0;

  for (const token of tokens) {
    const lemma = resolveLookupLemma(token);

    if (!lemma) {
      continue;
    }

    if (lemma === targetLemma) {
      return true;
    }

    const rank = lookupRank(lemma);
    const flags = resolveWordFlags(lemma, rank, settings, token);

    if (flags.isIgnored) {
      continue;
    }

    countedWords += 1;

    if (flags.shouldTranslate) {
      unknownCount += 1;
    }
  }

  const level = estimateLearnerLevel(settings);
  const budget = explanationUnknownWordBudget(level);

  if (unknownCount > budget) {
    return true;
  }

  return countedWords > 0 && unknownCount / countedWords > 0.2;
}

async function requestEnglishExplanation({
  surface,
  sentence,
  settings,
  userSettings,
  stricterPrompt,
}: {
  surface: string;
  sentence: string;
  settings: TranslatorSettings;
  userSettings: UserSettings;
  stricterPrompt?: string;
}): Promise<{ meaning: string; explanation: string }> {
  const knownCount = countTotalKnown(userSettings);
  const learnerLevel = estimateLearnerLevel(userSettings);
  const { content } = await executeLlmTask({
    settings,
    systemPrompt: buildEnglishExplanationSystemPrompt(settings, learnerLevel, knownCount),
    userPrompt: stricterPrompt
      ? `word: ${surface}\nsentence: ${sentence}\nextra rule: ${stricterPrompt}`
      : `word: ${surface}\nsentence: ${sentence}`,
    task: "english-explanation",
    sourceText: sentence,
  });

  return parseEnglishExplanationResponse(content);
}

export async function explainWordInEnglishWithLlm({
  surface,
  contextText,
  settings,
  userSettings,
}: {
  surface: string;
  contextText: string;
  settings: TranslatorSettings;
  userSettings: UserSettings;
}): Promise<EnglishExplanationResult> {
  if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {
    throw new Error(t(settings.learnerLanguageCode, "errorEnterApiKey"));
  }

  const sentence = trimContext(contextText || surface);
  const targetLemma = resolveLookupLemma(surface);

  const firstPass = await requestEnglishExplanation({
    surface,
    sentence,
    settings,
    userSettings,
  });

  let finalResult = firstPass;

  if (
    targetLemma &&
    explanationNeedsSimplifying(firstPass.explanation, targetLemma, userSettings)
  ) {
    finalResult = await requestEnglishExplanation({
      surface,
      sentence,
      settings,
      userSettings,
      stricterPrompt:
        "Rewrite the English explanation using easier and shorter words. Do not use the target word itself. Keep it to one short sentence.",
    }).catch(() => firstPass);
  }

  return {
    meaning: finalResult.meaning,
    explanation: finalResult.explanation,
    provider: getLlmProviderTag(),
    cached: false,
  };
}

export async function translateWithLlm({
  surface,
  contextText,
  settings,
  userSettings,
  responseMode,
}: {
  surface: string;
  contextText: string;
  settings: TranslatorSettings;
  userSettings?: UserSettings;
  responseMode?: TranslatorSettings["llmDisplayMode"];
}): Promise<TranslationResult> {
  if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {
    throw new TranslatorFallbackError("Missing LLM API key.");
  }

  const sentence = trimContext(contextText || surface);
  const structuredLexicon = await lookupStructuredLexicalSenses(surface, {
    contextText: sentence,
    learnerLanguageCode: settings.learnerLanguageCode,
  }).catch(() => ({ surface, lemma: resolveLookupLemma(surface), wordFormLabel: undefined, senses: [] }));
  const dictionarySenses = formatStructuredSensesForPrompt(structuredLexicon);
  const mode = responseMode ?? settings.llmDisplayMode;
  const needsSentence = mode === "sentence";
  const needsEnglishExplanation = mode === "english";
  const knownCount = userSettings ? countTotalKnown(userSettings) : 0;
  const learnerLevel = userSettings ? estimateLearnerLevel(userSettings) : "A2";
  let content = "";

  try {
    ({ content } = await executeLlmTask({
      settings,
      systemPrompt: buildWordTranslationSystemPrompt(settings, learnerLevel, knownCount, mode),
      userPrompt: `word: ${surface}\nlemma: ${structuredLexicon.lemma || resolveLookupLemma(surface)}\nword_form: ${structuredLexicon.wordFormLabel || "canonical"}\nsentence: ${sentence}\ndictionary_senses:\n${dictionarySenses}`,
      task: mode === "sentence"
        ? "contextual-word-sentence"
        : mode === "english"
          ? "contextual-word-english"
          : "contextual-word",
      sourceText: sentence,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM request failed.";

    if (
      error instanceof LlmProviderFormatError
      || shouldFallbackToGoogleOnLlmError(error)
    ) {
      throw new TranslatorFallbackError(message);
    }

    throw error;
  }

  const parsed = parseLlmTranslationResponse(content);

  if (
    needsEnglishExplanation &&
    userSettings
  ) {
    const targetLemma = resolveLookupLemma(surface);

    if (
      targetLemma &&
      parsed.englishExplanation &&
      explanationNeedsSimplifying(parsed.englishExplanation, targetLemma, userSettings)
    ) {
      const simplified = await requestEnglishExplanation({
        surface,
        sentence,
        settings,
        userSettings,
        stricterPrompt:
          "Rewrite the English explanation using easier and shorter words. Do not use the target word itself. Keep it to one short sentence.",
      }).catch(() => null);

      if (simplified) {
        parsed.translation = simplified.meaning;
        parsed.englishExplanation = simplified.explanation;
      }
    }
  }

  if (!parsed.translation) {
    throw new TranslatorFallbackError("LLM translation response was empty.");
  }

  const structuredMetadata = buildStructuredLexicalMetadata(
    structuredLexicon,
    parsed.translation,
  );

  return {
    translation: parsed.translation,
    sentenceTranslation: parsed.sentenceTranslation,
    englishExplanation: parsed.englishExplanation,
    contextualPartOfSpeech:
      parsed.contextualPartOfSpeech || structuredMetadata.contextualPartOfSpeech,
    lexicalLemma: structuredMetadata.lexicalLemma,
    wordFormLabel: structuredMetadata.wordFormLabel,
    semanticHint: parsed.semanticHint || structuredMetadata.semanticHint,
    alternativeMeanings: structuredMetadata.alternativeMeanings,
    provider: getLlmProviderTag(),
    cached: false,
  };
}

export async function translateSelectionWithLlm({
  text,
  contextText,
  settings,
}: {
  text: string;
  contextText: string;
  settings: TranslatorSettings;
}): Promise<TranslationResult> {
  if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {
    throw new TranslatorFallbackError("Missing LLM API key.");
  }

  const selection = text.replace(/\s+/g, " " ).trim().slice(0, 1200);
  const context = trimContext(contextText || text);
  let content = "";

  try {
    ({ content } = await executeLlmTask({
      settings,
      systemPrompt: buildSelectionTranslationSystemPrompt(settings),
      userPrompt: `selected_text: ${selection}
context: ${context}`,
      task: "selection-translation",
      sourceText: selection,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM selection request failed.";

    if (
      error instanceof LlmProviderFormatError
      || shouldFallbackToGoogleOnLlmError(error)
    ) {
      throw new TranslatorFallbackError(message);
    }

    throw error;
  }

  const parsed = parseLlmTranslationResponse(content);

  if (!parsed.translation) {
    throw new TranslatorFallbackError("LLM selection translation response was empty.");
  }

  return {
    translation: parsed.translation,
    provider: getLlmProviderTag(),
    cached: false,
  };
}

export async function analyzeSentenceWithLlm({
  text,
  settings,
}: {
  text: string;
  settings: TranslatorSettings;
}): Promise<SentenceAnalysisResult> {
  if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {
    throw new Error(t(settings.learnerLanguageCode, "errorEnterApiKey"));
  }

  const sentence = text.replace(/\s+/g, " ").trim().slice(0, 1200);
  const analysisPrompt = buildSentenceAnalysisPrompt(settings);

  try {
    let usedQualityRetry = false;
    let result: Omit<SentenceAnalysisResult, "provider" | "cached">;

    try {
      result = await requestSentenceAnalysis({ settings, sentence, systemPrompt: analysisPrompt });
    } catch (error) {
      if (!shouldRetrySentenceAnalysisError(error)) throw error;
      usedQualityRetry = true;
      result = await requestSentenceAnalysis({
        settings,
        sentence,
        systemPrompt: analysisPrompt,
        qualityRetry: true,
        retryFeedback: [error instanceof Error ? error.message : "previous response was invalid"],
      });
    }

    let validationErrors = sentenceAnalysisValidationErrors(result, sentence);
    if (validationErrors.length && !usedQualityRetry) {
      usedQualityRetry = true;
      result = await requestSentenceAnalysis({
        settings,
        sentence,
        systemPrompt: analysisPrompt,
        qualityRetry: true,
        retryFeedback: validationErrors,
      });
      validationErrors = sentenceAnalysisValidationErrors(result, sentence);
    }
    if (validationErrors.length) {
      throw new SentenceAnalysisFormatError(
        `Sentence analysis failed semantic validation: ${validationErrors.join("; ")}`,
      );
    }

    return { ...result, provider: getLlmProviderTag(), cached: false };
  } catch (error) {
    if (error instanceof SentenceAnalysisRequestError) {
      logSentenceAnalysisDebug("request_failed", {
        stage: error.stage, status: error.status, message: error.message, responseText: error.responseText, sentence,
      });
    } else if (error instanceof SentenceAnalysisFormatError) {
      logSentenceAnalysisDebug("format_failed", { message: error.message, sentence });
    }
    if (error instanceof SentenceAnalysisFormatError || error instanceof SentenceAnalysisRequestError) {
      throw new Error(t(settings.learnerLanguageCode, "errorSentenceAnalysisUnstable"));
    }
    throw error;
  }
}

export async function translateWithGoogle({
  lemma,
  surface,
  learnerLanguageCode,
}: {
  lemma: string;
  surface: string;
  learnerLanguageCode: SupportedLearnerLanguageCode;
}): Promise<TranslationResult> {
  const query = encodeURIComponent(surface || lemma);
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(learnerLanguageCode)}&dt=t&q=${query}`;

  const response = await fetchWithTimeout(url, {}, WORD_TRANSLATION_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const translation = parseGoogleTranslateResponse(payload);

  if (!translation) {
    throw new Error("Translation response was empty.");
  }

  return {
    translation,
    provider: "google-web",
    cached: false,
  };
}

export type TranslatorSettingsInput = Partial<Omit<TranslatorSettings, "llmProvider">> & {
  llmProvider?: string;
};

export function sanitizeTranslatorSettings(
  input?: TranslatorSettingsInput | null,
): TranslatorSettings {
  const rawCacheDurationValue = Number(input?.cacheDurationValue);
  const cacheDurationValue = Number.isFinite(rawCacheDurationValue)
    ? Math.min(10080, Math.max(1, Math.round(rawCacheDurationValue)))
    : DEFAULT_TRANSLATOR_SETTINGS.cacheDurationValue;
  const llmProvider = resolveStoredLlmProvider(input?.llmProvider, input?.providerBaseUrl);
  const provider = getLlmProviderDefinition(llmProvider);
  let providerModel = input?.providerModel?.trim() || provider.defaultModel;
  if (llmProvider === "anthropic" && providerModel === "claude-sonnet-4-20250514") {
    providerModel = provider.defaultModel;
  }

  return {
    defaultTranslationProvider: input?.defaultTranslationProvider === "llm" ? "llm" : "google",
    llmProvider,
    providerBaseUrl: provider.customBaseUrl
      ? input?.providerBaseUrl?.trim() || provider.defaultBaseUrl
      : provider.defaultBaseUrl,
    providerModel,
    apiKey: input?.apiKey?.trim() ?? "",
    fallbackToGoogle: input?.fallbackToGoogle ?? true,
    learnerLanguageCode: resolveLearnerLanguageOption(input?.learnerLanguageCode).code,
    llmDisplayMode:
      input?.llmDisplayMode === "sentence"
        ? "sentence"
        : input?.llmDisplayMode === "english"
          ? "english"
          : "word",
    cacheDurationValue,
    cacheDurationUnit: input?.cacheDurationUnit === "hours" ? "hours" : "minutes",
  };
}

export function sanitizeTranslatorProfile(
  input?: (Partial<Omit<TranslatorProfile, "llmProvider">> & { llmProvider?: string }) | null,
  fallbackId = DEFAULT_TRANSLATOR_PROFILE.id,
  fallbackName = DEFAULT_TRANSLATOR_PROFILE.name,
): TranslatorProfile {
  return {
    id: input?.id?.trim() || fallbackId,
    name: input?.name?.trim() || fallbackName,
    ...sanitizeTranslatorSettings(input),
  };
}

export function sanitizeTranslatorSettingsState(
  input?: Partial<TranslatorSettingsState> | null,
): TranslatorSettingsState {
  const rawProfiles = Array.isArray(input?.profiles) ? input.profiles : [];
  const profiles = rawProfiles.length
    ? rawProfiles.map((profile, index) =>
        sanitizeTranslatorProfile(
          profile,
          `profile-${index + 1}`,
          profile?.name?.trim() || `Profile ${index + 1}`,
        ))
      : [DEFAULT_TRANSLATOR_PROFILE];

  const activeProfileId = profiles.some((profile) => profile.id === input?.activeProfileId)
    ? (input?.activeProfileId as string)
    : profiles[0]?.id ?? DEFAULT_TRANSLATOR_PROFILE.id;

  return {
    activeProfileId,
    profiles,
  };
}

export function resolveActiveTranslatorProfile(state: TranslatorSettingsState): TranslatorProfile {
  return state.profiles.find((profile) => profile.id === state.activeProfileId)
    ?? state.profiles[0]
    ?? DEFAULT_TRANSLATOR_PROFILE;
}

export function getTranslatorCacheTtlMs(settings: TranslatorSettings): number {
  const multiplier = settings.cacheDurationUnit === "hours" ? 60 * 60 * 1000 : 60 * 1000;
  return settings.cacheDurationValue * multiplier;
}

export function isTranslatorFallbackError(error: unknown): boolean {
  return error instanceof TranslatorFallbackError;
}
