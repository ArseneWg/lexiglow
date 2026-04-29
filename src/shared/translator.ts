import { t } from "./i18n";
import { lookupRank, resolveLookupLemma } from "./lexicon";
import { countTotalKnown, estimateLearnerLevel, resolveWordFlags } from "./settings";
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
  providerModel: "gpt-4.1-mini",
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

const LLM_PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
  },
  claude: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
} as const;

const WORD_TRANSLATION_REQUEST_TIMEOUT_MS = 8000;
const SELECTION_TRANSLATION_REQUEST_TIMEOUT_MS = 10000;
const SENTENCE_ANALYSIS_REQUEST_TIMEOUT_MS = 20000;
const PRESERVE_PROPER_NAMES_INSTRUCTION =
  "Keep person names, usernames, brand names, and product names in their original English form instead of translating or transliterating them.";

function trimContext(contextText: string): string {
  const compact = contextText.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

export function getDefaultLlmBaseUrl(provider: TranslatorSettings["llmProvider"]): string {
  return LLM_PROVIDER_DEFAULTS[provider].baseUrl;
}

export function getDefaultLlmModel(provider: TranslatorSettings["llmProvider"]): string {
  return LLM_PROVIDER_DEFAULTS[provider].model;
}

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

  if (mode === "english") {
    return (
      `${buildLearnerLevelInstruction(learnerLevel, knownCount)} ` +
      "Translate the target English word or short phrase based on the sentence context. " +
      `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
      `First identify the exact meaning in ${meaningLanguage}. ` +
      "Then write exactly one short English sentence that explains the word in context. " +
      "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
      "Use simple, common English. Avoid advanced synonyms, long clauses, and dictionary jargon. " +
      "Avoid using the target word or its inflections in the explanation unless absolutely necessary. " +
      'Return strict JSON only: {"word":"<precise meaning in the learner language>","english":"<one short easy English sentence>","pos":"<single best part of speech in context>"}. No markdown or extra text.'
    );
  }

  if (mode === "sentence") {
    return (
      "Translate the target English word or short phrase based on the sentence context. " +
      `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
      "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
      `Return strict JSON only: {"word":"<concise meaning in ${meaningLanguage}>","sentence":"<full sentence translation in ${meaningLanguage}>","pos":"<single best part of speech in context>"}. No markdown, no explanation.`
    );
  }

  return (
    "Translate the target English word or short phrase based on the sentence context. " +
    `${PRESERVE_PROPER_NAMES_INSTRUCTION} ` +
    "Also identify the single best part of speech in this sentence using one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, phrase. " +
    `Return strict JSON only: {"word":"<concise meaning in ${meaningLanguage}>","pos":"<single best part of speech in context>"}. No markdown or extra text.`
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
    "2. structure: output one short English backbone sentence with branches removed. Keep only the clause skeleton, not a learner-language explanation. Do not copy the whole original sentence. Do not include sentence-opening adverbs such as presently or currently. Do not keep long modifier chains, relative clauses, subordinate clauses, participial branches, or prepositional detail that is not part of the skeleton. Keep only backbone subject + predicate + object/complement, or at most two backbone clauses if there is true top-level coordination. Keep each backbone clause within about 200 English words. If structure is close to the full sentence, it is wrong.",
    `3. analysisSteps: output exactly 4 ${meaningLanguage} sentences in this order:`,
    "   Step 1: cut the sentence into layers by connectors, punctuation, clauses, coordination, and nonfinite structures.",
    "   Step 2: identify the main clause subject, predicate, object or complement, and state the core meaning.",
    "   Step 3: explain logical groups, clauses, nonfinite phrases, modifiers, and what each part modifies.",
    "   Step 4: explain the learner-language translation order first and then support the final translation.",
    "   Keep each analysis step concise and review-friendly.",
    "4. highlights: output 5 to 8 strings in the format <category>|||<exact single word from sentence>. Allowed categories are [subject, predicate, nonfinite, conjunction, relative, preposition]. Choose structural signal words rather than ordinary content words. For medium or long sentences, prefer 6 to 8 highlights when possible. Each highlight must use the category that best matches the word's grammatical role in this sentence.",
    "   For conjunction, use only true connectors or subordinators such as and, but, although, because, if, while, when, since, whether. Do not use sentence adverbs or discourse markers such as presently, currently, now, overall, generally.",
    "   For relative, use only real relative words such as which, who, whom, whose, where, when, why, or that when it truly introduces a clause.",
    "   Never highlight possessive determiners or simple pronouns such as my, your, his, her, its, our, their, it, they, them, this, these, those.",
    '   Never highlight plain "that" when it is only a determiner, for example in "that data".',
    "5. clauseBlocks: output 2 to 6 strings in the format <type>|||<exact original text chunk>. Allowed types are [main, relative, subordinate, nonfinite, parallel, modifier]. The clauseBlocks must cover the whole sentence from first word to last word with no missing words and no overlap. Split long parts at commas, relative words, subordinators, coordinators, or nonfinite markers when that improves clarity, but do not isolate a bare preposition by itself.",
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

class LlmRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmRequestError";
    this.status = status;
  }
}

function cleanModelOutput(text: string): string {
  return text.trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

function readLlmError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const error = "error" in payload ? (payload as { error?: unknown }).error : payload;

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

function readOpenAiContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      return typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "";
    })
    .filter(Boolean)
    .join("");
}

function readGeminiContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  }).candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");
}

function readClaudeContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const content = (payload as {
    content?: Array<{ type?: unknown; text?: unknown }>;
  }).content ?? [];

  return content
    .map((block) => (
      block?.type === "text" && typeof block?.text === "string"
        ? block.text
        : ""
    ))
    .filter(Boolean)
    .join("");
}

function readOpenAiFinishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices;
  return typeof choices?.[0]?.finish_reason === "string" ? choices[0].finish_reason : "";
}

function readGeminiFinishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = (payload as { candidates?: Array<{ finishReason?: unknown }> }).candidates;
  return typeof candidates?.[0]?.finishReason === "string" ? candidates[0].finishReason : "";
}

function readClaudeFinishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  return typeof (payload as { stop_reason?: unknown }).stop_reason === "string"
    ? (payload as { stop_reason: string }).stop_reason
    : "";
}

function getLlmProviderTag(): string {
  return "llm";
}

export function getLlmCacheSignature(settings: Pick<
  TranslatorSettings,
  "llmProvider" | "providerBaseUrl" | "providerModel" | "learnerLanguageCode"
>): string {
  return [
    settings.llmProvider,
    settings.providerBaseUrl.trim().replace(/\/+$/, ""),
    settings.providerModel.trim(),
    settings.learnerLanguageCode,
  ].join("::");
}

function isMaxTokenFinishReason(finishReason: string): boolean {
  const normalized = finishReason.trim().toLowerCase();
  return normalized === "length" || normalized === "max_tokens" || normalized === "max tokens";
}

function resolveLlmEndpoint(settings: TranslatorSettings): string {
  const baseUrl = settings.providerBaseUrl.replace(/\/+$/, "");

  switch (settings.llmProvider) {
    case "gemini":
      return `${baseUrl}/models/${encodeURIComponent(settings.providerModel)}:generateContent`;
    case "claude":
      return `${baseUrl}/messages`;
    case "openai":
      return `${baseUrl}/chat/completions`;
  }
}

function shouldDisableOpenAiCompatibleThinking(settings: TranslatorSettings): boolean {
  return settings.llmProvider === "openai" && settings.providerModel.trim().toLowerCase().includes("qwen3");
}

async function requestLlmText({
  settings,
  systemPrompt,
  userPrompt,
  temperature,
  maxTokens,
  timeoutMs,
  preferJson,
}: {
  settings: TranslatorSettings;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  preferJson?: boolean;
}): Promise<{ content: string; finishReason: string; payload: unknown; response: Response }> {
  const endpoint = resolveLlmEndpoint(settings);

  let init: RequestInit;

  switch (settings.llmProvider) {
    case "gemini":
      init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": settings.apiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            ...(preferJson ? { responseMimeType: "application/json" } : {}),
          },
        }),
      };
      break;
    case "claude":
      init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: settings.providerModel,
          system: systemPrompt,
          temperature,
          max_tokens: maxTokens,
          messages: [
            {
              role: "user",
              content: userPrompt,
            },
          ],
        }),
      };
      break;
    case "openai":
      const openAiCompatibleRequestBody: Record<string, unknown> = {
        model: settings.providerModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      };

      if (shouldDisableOpenAiCompatibleThinking(settings)) {
        openAiCompatibleRequestBody.chat_template_kwargs = {
          enable_thinking: false,
        };
      }

      init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(openAiCompatibleRequestBody),
      };
      break;
  }

  const response = await fetchWithTimeout(endpoint, init, timeoutMs);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = readLlmError(payload);
    throw new LlmRequestError(message || `LLM request failed: ${response.status}`, response.status);
  }

  switch (settings.llmProvider) {
    case "gemini":
      return {
        content: readGeminiContent(payload),
        finishReason: readGeminiFinishReason(payload),
        payload,
        response,
      };
    case "claude":
      return {
        content: readClaudeContent(payload),
        finishReason: readClaudeFinishReason(payload),
        payload,
        response,
      };
    case "openai":
      return {
        content: readOpenAiContent(payload),
        finishReason: readOpenAiFinishReason(payload),
        payload,
        response,
      };
  }
}

function shouldFallbackToGoogle(status: number, message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    status === 401 ||
    status === 402 ||
    status === 429 ||
    normalized.includes("quota") ||
    normalized.includes("balance") ||
    normalized.includes("credit") ||
    normalized.includes("insufficient") ||
    normalized.includes("rate limit") ||
    normalized.includes("api key")
  );
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

  if (!query) {
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

      if (translation) {
        return {
          translation,
          sentenceTranslation: sentenceTranslation || undefined,
          englishExplanation: englishExplanation || undefined,
          contextualPartOfSpeech,
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

const ANALYSIS_PAIR_SEPARATOR = "|||";

function parseAnalysisPair(
  value: string,
): { left: string; right: string } | null {
  const separatorIndex = value.indexOf(ANALYSIS_PAIR_SEPARATOR);

  if (separatorIndex < 0) {
    return null;
  }

  const left = cleanModelOutput(value.slice(0, separatorIndex));
  const right = cleanModelOutput(value.slice(separatorIndex + ANALYSIS_PAIR_SEPARATOR.length));

  if (!left || !right) {
    return null;
  }

  return { left, right };
}

function sanitizeAnalysisHighlights(input: unknown): SentenceHighlight[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      if (typeof item === "string") {
        const parsedPair = parseAnalysisPair(item);

        if (!parsedPair) {
          return null;
        }

        const category = parsedPair.left as SentenceHighlightCategory;
        const text = parsedPair.right;
        const normalized = text.toLowerCase();

        if (
          !HIGHLIGHT_CATEGORIES.has(category) ||
          (category !== "preposition" && ANALYSIS_PLAIN_PREPOSITIONS.has(normalized))
        ) {
          return null;
        }

        return { text, category };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const text = cleanModelOutput(
        typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "",
      );
      const category =
        typeof (item as { category?: unknown }).category === "string"
          ? ((item as { category: string }).category as SentenceHighlightCategory)
          : null;
      const normalized = text.toLowerCase();

      if (
        !text ||
        !category ||
        !HIGHLIGHT_CATEGORIES.has(category) ||
        (category !== "preposition" && ANALYSIS_PLAIN_PREPOSITIONS.has(normalized))
      ) {
        return null;
      }

      return { text, category };
    })
    .filter((item): item is SentenceHighlight => Boolean(item));
}

const CLAUSE_BLOCK_TYPES = new Set<SentenceClauseBlockType>([
  "main",
  "relative",
  "subordinate",
  "nonfinite",
  "parallel",
  "modifier",
]);

function sanitizeClauseBlocks(input: unknown): SentenceClauseBlock[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const blocks = input
    .map((item) => {
      if (typeof item === "string") {
        const parsedPair = parseAnalysisPair(item);

        if (!parsedPair) {
          return null;
        }

        const type = parsedPair.left as SentenceClauseBlockType;
        const text = parsedPair.right;

        if (!text || !CLAUSE_BLOCK_TYPES.has(type)) {
          return null;
        }

        return {
          text,
          type,
          label: undefined,
        };
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const type = cleanModelOutput(
        typeof (item as { type?: unknown }).type === "string" ? (item as { type: string }).type : "",
      );
      const text = cleanModelOutput(
        typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "",
      );
      const label = cleanModelOutput(
        typeof (item as { label?: unknown }).label === "string"
          ? (item as { label: string }).label
          : "",
      );

      if (!text || !type || !CLAUSE_BLOCK_TYPES.has(type as SentenceClauseBlockType)) {
        return null;
      }

      return {
        text,
        type: type as SentenceClauseBlockType,
        label: label || undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return blocks.map((block) => (block.label ? block : { text: block.text, type: block.type }));
}

function extractJsonObjectText(content: string): string {
  const stripped = stripCodeFence(content);
  const jsonStart = stripped.indexOf("{");
  const jsonEnd = stripped.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new SentenceAnalysisFormatError("Sentence analysis response was not valid JSON.");
  }

  return stripped.slice(jsonStart, jsonEnd + 1);
}

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

  constructor(message: string, options?: { status?: number; responseText?: string; stage?: string }) {
    super(message);
    this.name = "SentenceAnalysisRequestError";
    this.status = options?.status;
    this.responseText = options?.responseText;
    this.stage = options?.stage;
  }
}

function logSentenceAnalysisDebug(event: string, detail: Record<string, unknown>) {
  console.warn("[LexiGlow][sentence-analysis]", event, detail);
}

function repairLooseJson(jsonText: string): string {
  const withoutTrailingCommas = jsonText.replace(/,\s*([}\]])/g, "$1");
  let output = "";
  let inString = false;
  let escaping = false;
  let lastSignificantChar = "";

  const canEndJsonValue = (char: string) =>
    char === '"' || char === "}" || char === "]" || /[0-9A-Za-z]/.test(char);
  const canStartJsonValue = (char: string) =>
    char === '"' || char === "{" || char === "[" || char === "-" || /[0-9tfn]/i.test(char);

  for (let index = 0; index < withoutTrailingCommas.length; index += 1) {
    const char = withoutTrailingCommas[index];

    if (inString) {
      output += char;

      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
        lastSignificantChar = '"';
      }

      continue;
    }

    if (char === '"') {
      if (
        lastSignificantChar &&
        canEndJsonValue(lastSignificantChar) &&
        canStartJsonValue(char) &&
        !["{", "[", ":", ","].includes(lastSignificantChar)
      ) {
        output += ",";
      }

      output += char;
      inString = true;
      continue;
    }

    if (/\s/.test(char)) {
      output += char;
      continue;
    }

    if (
      lastSignificantChar &&
      canEndJsonValue(lastSignificantChar) &&
      canStartJsonValue(char) &&
      !["{", "[", ":", ","].includes(lastSignificantChar)
    ) {
      output += ",";
    }

    output += char;
    lastSignificantChar = char;
  }

  return output;
}

function parseJsonObjectWithRepair<T>(payload: string): T {
  const rawJson = extractJsonObjectText(payload);

  try {
    return JSON.parse(rawJson) as T;
  } catch (error) {
    try {
      return JSON.parse(repairLooseJson(rawJson)) as T;
    } catch {
      throw new SentenceAnalysisFormatError(
        error instanceof Error ? error.message : "Sentence analysis response was not valid JSON.",
      );
    }
  }
}

export function parseSentenceAnalysisResponse(payload: string): Omit<
  SentenceAnalysisResult,
  "provider" | "cached"
> {
  const parsed = parseJsonObjectWithRepair<{
    translation?: unknown;
    structure?: unknown;
    analysisSteps?: unknown;
    cutSummary?: unknown;
    backboneSummary?: unknown;
    branchSummary?: unknown;
    translationSummary?: unknown;
    highlights?: unknown;
    clauseBlocks?: unknown;
  }>(payload);

  const translation = cleanModelOutput(
    typeof parsed.translation === "string" ? parsed.translation : "",
  );
  const structure = cleanModelOutput(typeof parsed.structure === "string" ? parsed.structure : "");
  const analysisStepsFromArray = Array.isArray(parsed.analysisSteps)
    ? parsed.analysisSteps
        .map((step) => cleanModelOutput(typeof step === "string" ? step : ""))
        .filter(Boolean)
    : [];
  const analysisStepsFromFields = [
    cleanModelOutput(typeof parsed.cutSummary === "string" ? parsed.cutSummary : ""),
    cleanModelOutput(typeof parsed.backboneSummary === "string" ? parsed.backboneSummary : ""),
    cleanModelOutput(typeof parsed.branchSummary === "string" ? parsed.branchSummary : ""),
    cleanModelOutput(typeof parsed.translationSummary === "string" ? parsed.translationSummary : ""),
  ].filter(Boolean);
  const analysisSteps =
    analysisStepsFromArray.length >= 4 ? analysisStepsFromArray : analysisStepsFromFields;
  const highlights = sanitizeAnalysisHighlights(parsed.highlights);
  const clauseBlocks = sanitizeClauseBlocks(parsed.clauseBlocks);

  if (!translation || !structure || !analysisSteps.length) {
    throw new SentenceAnalysisFormatError("Sentence analysis response was incomplete.");
  }

  return {
    translation,
    structure,
    analysisSteps,
    highlights,
    clauseBlocks,
  };
}

function sentenceAnalysisNeedsRetry(
  result: Omit<SentenceAnalysisResult, "provider" | "cached">,
  sentence: string,
): boolean {
  const wordCount = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g)?.length ?? 0;
  const minHighlights = wordCount <= 12 ? 1 : 2;
  const minBlocks = wordCount <= 12 ? 1 : 2;

  if (result.highlights.length < minHighlights || result.clauseBlocks.length < minBlocks) {
    return true;
  }

  const normalizedSentence = sentence.replace(/\s+/g, " ").trim();
  const coveredText = result.clauseBlocks.map((block) => block.text).join(" ");
  const normalizedCovered = coveredText.replace(/\s+/g, " ").trim();

  if (!normalizedCovered) {
    return true;
  }

  const coverageRatio = normalizedCovered.length / Math.max(normalizedSentence.length, 1);

  if (coverageRatio < 0.72) {
    return true;
  }

  const signalCategories = new Set(result.highlights.map((item) => item.category));
  if (wordCount <= 12) {
    return signalCategories.size < 1;
  }

  return signalCategories.size < 2;
}

async function requestSentenceAnalysis({
  settings,
  sentence,
  systemPrompt,
}: {
  settings: TranslatorSettings;
  sentence: string;
  systemPrompt: string;
}): Promise<Omit<SentenceAnalysisResult, "provider" | "cached">> {
  let llmResult: { content: string; finishReason: string; payload: unknown; response: Response };

  try {
    llmResult = await requestLlmText({
      settings,
      systemPrompt,
      userPrompt: `sentence: ${sentence}`,
      temperature: 0.1,
      maxTokens: 1000,
      timeoutMs: SENTENCE_ANALYSIS_REQUEST_TIMEOUT_MS,
      preferJson: true,
    });
  } catch (error) {
    throw new SentenceAnalysisRequestError(
      error instanceof Error ? error.message : "LLM analysis request failed.",
      {
        status: error instanceof LlmRequestError ? error.status : undefined,
        responseText: "",
        stage: "single-shot",
      },
    );
  }

  const { content, finishReason, payload, response } = llmResult;

  if (isMaxTokenFinishReason(finishReason)) {
    throw new SentenceAnalysisRequestError("Sentence analysis response was truncated by max tokens.", {
      status: response.status,
      responseText: content.slice(0, 1600),
      stage: "single-shot",
    });
  }

  try {
    return parseSentenceAnalysisResponse(content);
  } catch (error) {
    throw new SentenceAnalysisRequestError(
      error instanceof Error ? error.message : "Sentence analysis parsing failed.",
      {
        status: response.status,
        responseText: content.slice(0, 1600),
        stage: "single-shot",
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
  const { content } = await requestLlmText({
    settings,
    systemPrompt: buildEnglishExplanationSystemPrompt(settings, learnerLevel, knownCount),
    userPrompt: stricterPrompt
      ? `word: ${surface}\nsentence: ${sentence}\nextra rule: ${stricterPrompt}`
      : `word: ${surface}\nsentence: ${sentence}`,
    temperature: 0.2,
    maxTokens: 140,
    timeoutMs: WORD_TRANSLATION_REQUEST_TIMEOUT_MS,
    preferJson: true,
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
  if (!settings.apiKey.trim()) {
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
  if (!settings.apiKey.trim()) {
    throw new TranslatorFallbackError("Missing LLM API key.");
  }

  const sentence = trimContext(contextText || surface);
  const mode = responseMode ?? settings.llmDisplayMode;
  const needsSentence = mode === "sentence";
  const needsEnglishExplanation = mode === "english";
  const knownCount = userSettings ? countTotalKnown(userSettings) : 0;
  const learnerLevel = userSettings ? estimateLearnerLevel(userSettings) : "A2";
  let content = "";

  try {
    ({ content } = await requestLlmText({
      settings,
      systemPrompt: buildWordTranslationSystemPrompt(settings, learnerLevel, knownCount, mode),
      userPrompt: `word: ${surface}\nsentence: ${sentence}`,
      temperature: 0,
      maxTokens: needsEnglishExplanation ? 140 : needsSentence ? 96 : 40,
      timeoutMs: WORD_TRANSLATION_REQUEST_TIMEOUT_MS,
      preferJson: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM request failed.";

    if (shouldFallbackToGoogle(error instanceof LlmRequestError ? error.status ?? 0 : 0, message)) {
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

  return {
    translation: parsed.translation,
    sentenceTranslation: parsed.sentenceTranslation,
    englishExplanation: parsed.englishExplanation,
    contextualPartOfSpeech: parsed.contextualPartOfSpeech,
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
  if (!settings.apiKey.trim()) {
    throw new TranslatorFallbackError("Missing LLM API key.");
  }

  const selection = trimContext(text);
  const context = trimContext(contextText || text);
  let content = "";

  try {
    ({ content } = await requestLlmText({
      settings,
      systemPrompt: buildSelectionTranslationSystemPrompt(settings),
      userPrompt: `selected_text: ${selection}\ncontext: ${context}`,
      temperature: 0,
      maxTokens: 180,
      timeoutMs: SELECTION_TRANSLATION_REQUEST_TIMEOUT_MS,
      preferJson: true,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM selection request failed.";

    if (shouldFallbackToGoogle(error instanceof LlmRequestError ? error.status ?? 0 : 0, message)) {
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
  if (!settings.apiKey.trim()) {
    throw new Error(t(settings.learnerLanguageCode, "errorEnterApiKey"));
  }

  const sentence = text.trim();
  const analysisPrompt = buildSentenceAnalysisPrompt(settings);

  try {
    const result = await requestSentenceAnalysis({
      settings,
      sentence,
      systemPrompt: analysisPrompt,
    });

    return {
      ...result,
      provider: getLlmProviderTag(),
      cached: false,
    };
  } catch (error) {
    if (error instanceof SentenceAnalysisRequestError) {
      logSentenceAnalysisDebug("request_failed", {
        stage: error.stage,
        status: error.status,
        message: error.message,
        responseText: error.responseText,
        sentence,
      });
    } else if (error instanceof SentenceAnalysisFormatError) {
      logSentenceAnalysisDebug("format_failed", {
        message: error.message,
        sentence,
      });
    }

    if (error instanceof SentenceAnalysisFormatError) {
      throw new Error(t(settings.learnerLanguageCode, "errorSentenceAnalysisUnstable"));
    }

    if (error instanceof SentenceAnalysisRequestError) {
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

export function sanitizeTranslatorSettings(
  input?: Partial<TranslatorSettings> | null,
): TranslatorSettings {
  const rawCacheDurationValue = Number(input?.cacheDurationValue);
  const cacheDurationValue = Number.isFinite(rawCacheDurationValue)
    ? Math.min(10080, Math.max(1, Math.round(rawCacheDurationValue)))
    : DEFAULT_TRANSLATOR_SETTINGS.cacheDurationValue;
  const llmProvider = input?.llmProvider === "gemini"
    ? "gemini"
    : input?.llmProvider === "claude"
      ? "claude"
      : "openai";

  return {
    defaultTranslationProvider: input?.defaultTranslationProvider === "llm" ? "llm" : "google",
    llmProvider,
    providerBaseUrl: input?.providerBaseUrl?.trim() || getDefaultLlmBaseUrl(llmProvider),
    providerModel: input?.providerModel?.trim() || getDefaultLlmModel(llmProvider),
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
  input?: Partial<TranslatorProfile> | null,
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
