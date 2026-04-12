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
    .filter((item): item is SentenceClauseBlock => Boolean(item));
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

type SentenceAnalysisFrame = {
  translation: string;
  structure: string;
  highlights: SentenceHighlight[];
  clauseBlocks: SentenceClauseBlock[];
};

function parseSentenceAnalysisFrameResponse(payload: string): SentenceAnalysisFrame {
  const parsed = parseJsonObjectWithRepair<{
    translation?: unknown;
    structure?: unknown;
    highlights?: unknown;
    clauseBlocks?: unknown;
  }>(payload);

  const translation = cleanModelOutput(
    typeof parsed.translation === "string" ? parsed.translation : "",
  );
  const structure = cleanModelOutput(typeof parsed.structure === "string" ? parsed.structure : "");
  const highlights = sanitizeAnalysisHighlights(parsed.highlights);
  const clauseBlocks = sanitizeClauseBlocks(parsed.clauseBlocks);

  if (!translation || !structure || !clauseBlocks.length) {
    throw new SentenceAnalysisFormatError("Sentence analysis frame response was incomplete.");
  }

  return {
    translation,
    structure,
    highlights,
    clauseBlocks,
  };
}

function parseSentenceAnalysisSummariesResponse(payload: string): string[] {
  const parsed = parseJsonObjectWithRepair<{
    analysisSteps?: unknown;
    cutSummary?: unknown;
    backboneSummary?: unknown;
    branchSummary?: unknown;
    translationSummary?: unknown;
  }>(payload);

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

  if (analysisSteps.length < 3) {
    throw new SentenceAnalysisFormatError("Sentence analysis summaries response was incomplete.");
  }

  return analysisSteps.slice(0, 4);
}

function buildFallbackAnalysisSteps(
  frame: SentenceAnalysisFrame,
  sentence: string,
): string[] {
  const wordCount = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g)?.length ?? 0;
  const blockHint =
    frame.clauseBlocks.length > 1
      ? `这句可以先按 ${frame.clauseBlocks.length} 个彩色句块来切层次。`
      : wordCount > 16
        ? "这句可以先抓主干，再按从句和修饰链往后拆。"
        : "这句整体不算复杂，先抓主干再看修饰部分即可。";

  return [
    blockHint,
    `主干先抓成：${frame.structure}`,
    "再看彩色句块之间的从句、并列、非谓语和介词修饰关系。",
    `最后顺着中文表达整句可译为：${frame.translation}`,
  ];
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

function sentenceHighlightsNeedSupplement(
  highlights: SentenceHighlight[],
): boolean {
  if (highlights.length < 3) {
    return true;
  }

  const categories = new Set(highlights.map((item) => item.category));
  const hasCoreAction = categories.has("predicate") || categories.has("nonfinite");
  const hasStructureSignal =
    categories.has("conjunction") ||
    categories.has("relative") ||
    categories.has("preposition");

  return !hasCoreAction || !hasStructureSignal;
}

async function requestSentenceAnalysis({
  endpoint,
  apiKey,
  model,
  sentence,
  systemPrompt,
  useJsonResponseFormat = true,
  stage = "base",
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
  systemPrompt: string;
  useJsonResponseFormat?: boolean;
  stage?: string;
}): Promise<Omit<SentenceAnalysisResult, "provider" | "cached">> {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 360,
    ...(useJsonResponseFormat
      ? {
          response_format: {
            type: "json_object",
          },
        }
      : {}),
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
    throw new SentenceAnalysisRequestError(message || `LLM analysis request failed: ${response.status}`, {
      status: response.status,
      responseText: payload?.choices?.[0]?.message?.content ?? JSON.stringify(payload ?? "").slice(0, 1600),
      stage,
    });
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";

  try {
    return parseSentenceAnalysisResponse(content);
  } catch (error) {
    throw new SentenceAnalysisRequestError(
      error instanceof Error ? error.message : "Sentence analysis parsing failed.",
      {
        status: response.status,
        responseText: content.slice(0, 1600),
        stage,
      },
    );
  }
}

async function requestSentenceAnalysisFrame(args: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
  systemPrompt: string;
  useJsonResponseFormat?: boolean;
  stage?: string;
}): Promise<SentenceAnalysisFrame> {
  const content = await requestSentenceAnalysisContent(args);
  return parseSentenceAnalysisFrameResponse(content);
}

async function requestSentenceAnalysisSummaries(args: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
  systemPrompt: string;
  useJsonResponseFormat?: boolean;
  stage?: string;
}): Promise<string[]> {
  const content = await requestSentenceAnalysisContent(args);
  return parseSentenceAnalysisSummariesResponse(content);
}

async function requestSentenceAnalysisContent({
  endpoint,
  apiKey,
  model,
  sentence,
  systemPrompt,
  useJsonResponseFormat = true,
  stage = "base",
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  sentence: string;
  systemPrompt: string;
  useJsonResponseFormat?: boolean;
  stage?: string;
}): Promise<string> {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: stage.includes("summary") ? 220 : 260,
    ...(useJsonResponseFormat
      ? {
          response_format: {
            type: "json_object",
          },
        }
      : {}),
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
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        error?: { message?: string };
      }
    | null;

  const finishReason = payload?.choices?.[0]?.finish_reason ?? "";

  if (!response.ok) {
    const message = readLlmError(payload);
    throw new SentenceAnalysisRequestError(message || `LLM analysis request failed: ${response.status}`, {
      status: response.status,
      responseText: payload?.choices?.[0]?.message?.content ?? JSON.stringify(payload ?? "").slice(0, 1600),
      stage,
    });
  }

  const content = payload?.choices?.[0]?.message?.content ?? "";

  if (finishReason === "length") {
    throw new SentenceAnalysisRequestError("Sentence analysis response was truncated by max tokens.", {
      status: response.status,
      responseText: content.slice(0, 1600),
      stage,
    });
  }

  return content;
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
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content:
          'Extract only structural signal words from the English sentence for long-sentence analysis. Return strict JSON only: {"highlights":["<category>|||<exact single word from sentence>"]}. Choose 3 to 8 exact single-word tokens copied from the sentence. Prefer: finite predicates, relative words like who/which/that when they truly introduce clauses, subordinators like because/if/although/when, the real nonfinite verb after to do, important doing/done forms, coordinators like and/but/or, and occasionally a key preposition such as of/in/with/by/through when it truly helps cut structure. Never output content nouns. Never output possessive determiners or simple pronouns like my, your, his, her, its, our, their, it, they, them, this, these, those. Never output plain "that" when it is only a determiner such as "that data". Allowed categories: subject, predicate, nonfinite, conjunction, relative, preposition.',
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
  const framePrompt =
    'You are an English sentence analysis tutor for Chinese students. First identify the sentence backbone and then cut the sentence into visual chunks. Return strict JSON only with keys: translation, structure, highlights, clauseBlocks. translation is the full Chinese translation in one natural sentence. structure is one short Chinese sentence that states the backbone only. highlights must be an array of 3 to 8 strings in the format "<category>|||<exact single word from sentence>". Allowed categories are [subject, predicate, nonfinite, conjunction, relative, preposition]. Choose only structural signal words, not content words. Never highlight possessive determiners or simple pronouns like my, your, his, her, its, our, their, it, they, them, this, these, those. Never highlight that when it is only a determiner such as that data. clauseBlocks must be an array of 3 to 8 strings in the format "<type>|||<exact original text chunk>". Allowed types are [main, relative, subordinate, nonfinite, parallel, modifier]. The clauseBlocks must together cover the whole sentence from first word to last word with no missing words and no overlap. Every major part of the sentence should belong to some clauseBlock. If a chunk is too long, split it at commas, relative words, subordinators, coordinating conjunctions, or nonfinite markers so the visual segmentation stays clear. Each chunk should usually stay within about 3 to 12 words when possible. If a clause or phrase contains a long prepositional branch or a preposition-led noun clause that provides a distinct modifier/complement layer, split that branch into its own clauseBlock. However, do not isolate a bare leading preposition by itself; keep the preposition attached to its object, complement, or clause inside the same clauseBlock. Example JSON format: {"translation":"中文整句","structure":"主干说明","highlights":["relative|||which"],"clauseBlocks":["relative|||which describes ..."]}.';
  const frameSafePrompt =
    `${framePrompt} Output must be valid compact JSON parsable by JSON.parse. Do not include markdown fences. Do not include extra commentary outside the JSON object.`;
  const summaryPrompt =
    'You are an English sentence analysis tutor for Chinese students. Return strict JSON only with keys: cutSummary, backboneSummary, branchSummary, translationSummary. Each value must be one short Chinese sentence. cutSummary explains how to cut the sentence into layers by signal words or punctuation. backboneSummary explains the main clause subject, predicate, and backbone. branchSummary explains important branches: what modifies what, what depends on what, what serves as object/complement of what, and if there is any coordination or parallel structure, clearly state exactly which words, phrases, or clauses are parallel and what connector links them. translationSummary explains the final translation order in one short sentence. No markdown, no numbering, no nested lists, no extra keys.';
  const summarySafePrompt =
    `${summaryPrompt} Output must be valid compact JSON parsable by JSON.parse. Do not include markdown fences. Do not include extra commentary outside the JSON object.`;

  try {
    let frame: SentenceAnalysisFrame | null = null;

    try {
      frame = await requestSentenceAnalysisFrame({
        endpoint,
        apiKey: settings.apiKey,
        model: settings.providerModel,
        sentence,
        systemPrompt: framePrompt,
        useJsonResponseFormat: true,
        stage: "frame-json",
      });
    } catch {
      try {
        frame = await requestSentenceAnalysisFrame({
          endpoint,
          apiKey: settings.apiKey,
          model: settings.providerModel,
          sentence,
          systemPrompt: frameSafePrompt,
          useJsonResponseFormat: true,
          stage: "frame-safe-json",
        });
      } catch {
        frame = await requestSentenceAnalysisFrame({
          endpoint,
          apiKey: settings.apiKey,
          model: settings.providerModel,
          sentence,
          systemPrompt: frameSafePrompt,
          useJsonResponseFormat: false,
          stage: "frame-text",
        });
      }
    }

    if (!frame) {
      throw new SentenceAnalysisFormatError("Sentence analysis frame response was not valid JSON.");
    }

    if (sentenceHighlightsNeedSupplement(frame.highlights)) {
      const extraHighlights = await requestSentenceHighlights({
        endpoint,
        apiKey: settings.apiKey,
        model: settings.providerModel,
        sentence,
      }).catch(() => []);

      if (extraHighlights.length) {
        const seen = new Set(frame.highlights.map((item) => `${item.text.toLowerCase()}::${item.category}`));
        frame = {
          ...frame,
          highlights: [
            ...frame.highlights,
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

    let analysisSteps = buildFallbackAnalysisSteps(frame, sentence);

    try {
      const summarySentence = [
        `sentence: ${sentence}`,
        `translation: ${frame.translation}`,
        `structure: ${frame.structure}`,
        `highlights: ${frame.highlights.map((item) => `${item.category}:${item.text}`).join(" | ")}`,
        `clauseBlocks: ${frame.clauseBlocks.map((item) => `${item.type}:${item.text}`).join(" || ")}`,
      ].join("\n");

      try {
        analysisSteps = await requestSentenceAnalysisSummaries({
          endpoint,
          apiKey: settings.apiKey,
          model: settings.providerModel,
          sentence: summarySentence,
          systemPrompt: summaryPrompt,
          useJsonResponseFormat: true,
          stage: "summary-json",
        });
      } catch {
        analysisSteps = await requestSentenceAnalysisSummaries({
            endpoint,
            apiKey: settings.apiKey,
            model: settings.providerModel,
            sentence: summarySentence,
            systemPrompt: summarySafePrompt,
            useJsonResponseFormat: false,
            stage: "summary-text",
        });
      }
    } catch (error) {
      logSentenceAnalysisDebug("summary_fallback", {
        message: error instanceof Error ? error.message : "Unknown summary error.",
        sentence,
      });
    }

    return {
      ...frame,
      analysisSteps,
      provider: "deepseek-chat",
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
      throw new Error("长难句分析返回格式不稳定，请重试一次。");
    }

    if (error instanceof SentenceAnalysisRequestError) {
      throw new Error("长难句分析返回格式不稳定，请重试一次。");
    }

    throw error;
  }
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
