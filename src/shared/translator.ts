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
  TranslationResult,
  TranslatorSettings,
  UserSettings,
} from "./types";

export const DEFAULT_TRANSLATOR_SETTINGS: TranslatorSettings = {
  providerBaseUrl: "https://api.deepseek.com/v1",
  providerModel: "deepseek-chat",
  apiKey: "",
  fallbackToGoogle: true,
  llmDisplayMode: "word",
};

function trimContext(contextText: string): string {
  const compact = contextText.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
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

export function parseLlmTranslationResponse(payload: string): {
  translation: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
} {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
        word?: unknown;
        sentence?: unknown;
      };
      const translation = cleanModelOutput(typeof parsed.word === "string" ? parsed.word : "");
      const sentenceTranslation = cleanModelOutput(
        typeof parsed.sentence === "string" ? parsed.sentence : "",
      );
      const englishExplanation = cleanModelOutput(
        typeof parsed.english === "string" ? parsed.english : "",
      );

      if (translation) {
        return {
          translation,
          sentenceTranslation: sentenceTranslation || undefined,
          englishExplanation: englishExplanation || undefined,
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

function sanitizeAnalysisHighlights(input: unknown): SentenceHighlight[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
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

function parseSentenceHighlightsOnlyResponse(payload: string): SentenceHighlight[] {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return [];
  }

  try {
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
      highlights?: unknown;
    };
    return sanitizeAnalysisHighlights(parsed.highlights);
  } catch {
    return [];
  }
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

  return input
    .map((item) => {
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
    .filter((item): item is SentenceClauseBlock => Boolean(item));
}

export function parseSentenceAnalysisResponse(payload: string): Omit<
  SentenceAnalysisResult,
  "provider" | "cached"
> {
  const content = stripCodeFence(payload);
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("Sentence analysis response was not valid JSON.");
  }

  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
    translation?: unknown;
    structure?: unknown;
    analysisSteps?: unknown;
    highlights?: unknown;
    clauseBlocks?: unknown;
  };

  const translation = cleanModelOutput(
    typeof parsed.translation === "string" ? parsed.translation : "",
  );
  const structure = cleanModelOutput(typeof parsed.structure === "string" ? parsed.structure : "");
  const analysisSteps = Array.isArray(parsed.analysisSteps)
    ? parsed.analysisSteps
        .map((step) => cleanModelOutput(typeof step === "string" ? step : ""))
        .filter(Boolean)
    : [];
  const highlights = sanitizeAnalysisHighlights(parsed.highlights);
  const clauseBlocks = sanitizeClauseBlocks(parsed.clauseBlocks);

  if (!translation || !structure || !analysisSteps.length) {
    throw new Error("Sentence analysis response was incomplete.");
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
  if (result.highlights.length < 2 || result.clauseBlocks.length < 2) {
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
  return signalCategories.size < 2;
}

async function requestSentenceAnalysis({
  endpoint,
  apiKey,
  model,
  sentence,
  systemPrompt,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
  systemPrompt: string;
}): Promise<Omit<SentenceAnalysisResult, "provider" | "cached">> {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 520,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `sentence: ${sentence}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);
    throw new Error(message || `LLM analysis request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
  return parseSentenceAnalysisResponse(content);
}

async function requestSentenceHighlights({
  endpoint,
  apiKey,
  model,
  sentence,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
}): Promise<SentenceHighlight[]> {
  const body = {
    model,
    temperature: 0,
    max_tokens: 160,
    messages: [
      {
        role: "system",
        content:
          'Extract only structural signal words from the English sentence for long-sentence analysis. Return strict JSON only: {"highlights":[{"text":"<exact single word from sentence>","category":"<subject|predicate|nonfinite|conjunction|relative|preposition>"}]}. Choose 3 to 8 exact single-word tokens copied from the sentence. Prefer: finite predicates, relative words like who/which/that when they truly introduce clauses, subordinators like because/if/although/when, the real nonfinite verb after to do, important doing/done forms, coordinators like and/but/or, and occasionally a key preposition such as of/in/with/by/through when it truly helps cut structure. Never output content nouns. Never output possessive determiners or simple pronouns like my, your, his, her, its, our, their, it, they, them, this, these, those. Never output plain "that" when it is only a determiner such as "that data".',
      },
      {
        role: "user",
        content: `sentence: ${sentence}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);
    throw new Error(message || `LLM highlight request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
  return parseSentenceHighlightsOnlyResponse(content);
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
  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const knownCount = countTotalKnown(userSettings);
  const learnerLevel = estimateLearnerLevel(userSettings);
  const body = {
    model: settings.providerModel,
    temperature: 0.2,
    max_tokens: 140,
    messages: [
      {
        role: "system",
        content:
          `${buildLearnerLevelInstruction(learnerLevel, knownCount)} ` +
          'You explain English words to Chinese learners. First identify the exact Chinese meaning of the target word in the given sentence context. Then write exactly one short English sentence that explains the word in that context. Use simple, common English. Avoid advanced synonyms, long clauses, and dictionary jargon. Avoid using the target word or its inflections in the explanation unless absolutely necessary. Return strict JSON only: {"meaning":"<precise Chinese meaning in context>","explanation":"<one short easy English sentence>"}. No markdown, no extra text.',
      },
      {
        role: "user",
        content: stricterPrompt
          ? `word: ${surface}\nsentence: ${sentence}\nextra rule: ${stricterPrompt}`
          : `word: ${surface}\nsentence: ${sentence}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);
    throw new Error(message || `LLM explanation request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
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
    throw new Error("请先在设置页填写 LLM API Key。");
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
    provider: "deepseek-chat",
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

  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const sentence = trimContext(contextText || surface);
  const mode = responseMode ?? settings.llmDisplayMode;
  const needsSentence = mode === "sentence";
  const needsEnglishExplanation = mode === "english";
  const knownCount = userSettings ? countTotalKnown(userSettings) : 0;
  const learnerLevel = userSettings ? estimateLearnerLevel(userSettings) : "A2";
  const body = {
    model: settings.providerModel,
    temperature: 0,
    max_tokens: needsEnglishExplanation ? 140 : needsSentence ? 96 : 40,
    messages: [
      {
        role: "system",
        content: needsEnglishExplanation
          ? `${buildLearnerLevelInstruction(learnerLevel, knownCount)} Translate the target English word or short phrase based on the sentence context. First identify the exact Chinese meaning in context. Then write exactly one short English sentence that explains the word in context. Use simple, common English. Avoid advanced synonyms, long clauses, and dictionary jargon. Avoid using the target word or its inflections in the explanation unless absolutely necessary. Return strict JSON only: {"word":"<precise Chinese meaning in context>","english":"<one short easy English sentence>"}. No markdown or extra text.`
          : needsSentence
            ? 'Translate the target English word or short phrase based on the sentence context. Return strict JSON only: {"word":"<concise Chinese meaning of the word or phrase>","sentence":"<full Chinese translation of the sentence>"}. No markdown, no explanation.'
            : 'Translate the target English word or short phrase into concise Chinese based on the sentence context. Return strict JSON only: {"word":"<concise Chinese meaning>"}',
      },
      {
        role: "user",
        content: `word: ${surface}\nsentence: ${sentence}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);

    if (shouldFallbackToGoogle(response.status, message)) {
      throw new TranslatorFallbackError(message || `LLM request failed: ${response.status}`);
    }

    throw new Error(message || `LLM request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
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
    provider: "deepseek-chat",
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

  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const selection = trimContext(text);
  const context = trimContext(contextText || text);
  const body = {
    model: settings.providerModel,
    temperature: 0,
    max_tokens: 180,
    messages: [
      {
        role: "system",
        content:
          'Translate the selected English text into natural Chinese. If the selected text is a single word or a short phrase, translate that unit precisely based on context. If the selected text is a clause or a full sentence, translate the whole selected text completely and naturally. Return strict JSON only: {"word":"<Chinese translation of the selected text>"} with no markdown or extra text.',
      },
      {
        role: "user",
        content: `selected_text: ${selection}\ncontext: ${context}`,
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    const message = readLlmError(payload);

    if (shouldFallbackToGoogle(response.status, message)) {
      throw new TranslatorFallbackError(message || `LLM selection request failed: ${response.status}`);
    }

    throw new Error(message || `LLM selection request failed: ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = parseLlmTranslationResponse(content);

  if (!parsed.translation) {
    throw new TranslatorFallbackError("LLM selection translation response was empty.");
  }

  return {
    translation: parsed.translation,
    provider: "deepseek-chat",
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
    throw new Error("请先在设置页填写 LLM API Key。");
  }

  const endpoint = `${settings.providerBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const sentence = trimContext(text);
  const basePrompt =
    'You are an English sentence analysis tutor for Chinese students. Use a Tian Jing style exam-prep method: first find signal words and punctuation to cut the sentence into layers; then locate the main clause subject and predicate and state the backbone; then explain relative clauses, subordinate clauses, nonfinite structures, appositives, and modifier chains as branches attached to the backbone; finally give a smooth Chinese translation in natural order. The explanation should feel like a teacher walking through a sentence, practical and clear, not vague and not too academic. Return strict JSON only with keys: translation, structure, analysisSteps, highlights, clauseBlocks. translation is full Chinese translation. structure is one short Chinese summary of the sentence backbone. analysisSteps is an array of exactly 4 Chinese steps, roughly 切层次 / 抓主干 / 拆枝叶 / 顺译. highlights is an array of 3 to 10 exact single-word tokens copied from the original sentence with category from [subject, predicate, nonfinite, conjunction, relative, preposition]. Choose only structural signal words, not content words. Structural signal words include: 1) relative words: who, whom, whose, which, that when they really introduce clauses; 2) subordinators: because, since, as, if, unless, although, though, even though, while, when, before, after, until, where, so that, in order that; 3) nonfinite markers: to do, doing, done, but highlight the real nonfinite verb keyword, not the word to; 4) coordinators and parallel markers: and, or, but, not...but..., not only...but also...; 5) punctuation-triggered logic around commas, semicolons, dashes, and parentheses; 6) sometimes a key preposition in a long modifier chain such as of, in, with, by, through, when it truly helps cut structure; 7) special clause trigger words such as how, whether, what, why in noun clauses. Never highlight ordinary content nouns. Never highlight possessive determiners or simple pronouns like my, your, his, her, its, our, their, it, they, them, this, these, those. Never highlight that when it is only a determiner such as that data. clauseBlocks is an array of 3 to 8 exact text chunks copied from the original sentence in original order. The clauseBlocks must together cover the whole sentence from first word to last word with no missing words and no overlap. Every major part of the sentence should belong to some clauseBlock. If a chunk is too long, split it at commas, relative words, subordinators, coordinating conjunctions, or nonfinite markers so the visual segmentation stays clear. Each chunk should usually stay within about 3 to 12 words when possible. type must be one of [main, relative, subordinate, nonfinite, parallel, modifier]. No markdown or extra text.';
  const retryPrompt =
    `${basePrompt} Important quality bar: the highlights must not be empty, and they must include at least one real predicate or nonfinite signal plus at least one connector/relative/preposition signal when available. The clauseBlocks must visually cover the entire sentence. Do not leave any tail text outside the clauseBlocks.`;

  let parsed = await requestSentenceAnalysis({
    endpoint,
    apiKey: settings.apiKey,
    model: settings.providerModel,
    sentence,
    systemPrompt: basePrompt,
  });

  if (sentenceAnalysisNeedsRetry(parsed, sentence)) {
    parsed = await requestSentenceAnalysis({
      endpoint,
      apiKey: settings.apiKey,
      model: settings.providerModel,
      sentence,
      systemPrompt: retryPrompt,
    });
  }

  if (parsed.highlights.length < 2) {
    const extraHighlights = await requestSentenceHighlights({
      endpoint,
      apiKey: settings.apiKey,
      model: settings.providerModel,
      sentence,
    }).catch(() => []);

    if (extraHighlights.length) {
      const seen = new Set(parsed.highlights.map((item) => `${item.text.toLowerCase()}::${item.category}`));
      parsed = {
        ...parsed,
        highlights: [
          ...parsed.highlights,
          ...extraHighlights.filter((item) => {
            const key = `${item.text.toLowerCase()}::${item.category}`;

            if (seen.has(key)) {
              return false;
            }

            seen.add(key);
            return true;
          }),
        ],
      };
    }
  }

  return {
    ...parsed,
    provider: "deepseek-chat",
    cached: false,
  };
}

export async function translateWithGoogle({
  lemma,
  surface,
}: {
  lemma: string;
  surface: string;
}): Promise<TranslationResult> {
  const query = encodeURIComponent(surface || lemma);
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${query}`;

  const response = await fetch(url);

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
  return {
    providerBaseUrl: input?.providerBaseUrl?.trim() || DEFAULT_TRANSLATOR_SETTINGS.providerBaseUrl,
    providerModel: input?.providerModel?.trim() || DEFAULT_TRANSLATOR_SETTINGS.providerModel,
    apiKey: input?.apiKey?.trim() ?? "",
    fallbackToGoogle: input?.fallbackToGoogle ?? true,
    llmDisplayMode:
      input?.llmDisplayMode === "sentence"
        ? "sentence"
        : input?.llmDisplayMode === "english"
          ? "english"
          : "word",
  };
}

export function isTranslatorFallbackError(error: unknown): boolean {
  return error instanceof TranslatorFallbackError;
}
