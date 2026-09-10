
import type { LlmTaskContract, LlmTaskKind } from "./contracts";

const POS_ENUM = [
  "noun", "verb", "adjective", "adverb", "pronoun", "preposition",
  "conjunction", "determiner", "auxiliary", "phrase",
];
const HIGHLIGHT_CATEGORIES = [
  "subject", "predicate", "nonfinite", "conjunction", "relative", "preposition",
];
const CLAUSE_TYPES = ["main", "relative", "subordinate", "nonfinite", "parallel", "modifier"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

function requiresStrings(value: unknown, keys: string[]): boolean {
  return isRecord(value) && keys.every((key) => nonEmptyString(value[key]));
}

function isAllowedPartOfSpeech(value: unknown): boolean {
  return typeof value === "string" && POS_ENUM.includes(value.trim());
}

function validatesContextualWordFields(value: unknown, extraKeys: string[] = []): boolean {
  return requiresStrings(value, ["word", "pos", "hint", ...extraKeys])
    && isRecord(value)
    && isAllowedPartOfSpeech(value.pos);
}

const wordProperties = {
  word: { type: "string" },
  pos: { type: "string", enum: POS_ENUM },
  hint: { type: "string" },
};

const contextualWord: LlmTaskContract = {
  kind: "contextual-word",
  schemaName: "lexiglow_contextual_word",
  schema: {
    type: "object",
    properties: wordProperties,
    required: ["word", "pos", "hint"],
    additionalProperties: false,
  },
  example: { word: "预测", pos: "noun", hint: "此处表示模型预测" },
  reasoning: "off",
  validate(value) { return validatesContextualWordFields(value); },
};

const contextualWordSentence: LlmTaskContract = {
  kind: "contextual-word-sentence",
  schemaName: "lexiglow_contextual_word_sentence",
  schema: {
    type: "object",
    properties: { ...wordProperties, sentence: { type: "string" } },
    required: ["word", "sentence", "pos", "hint"],
    additionalProperties: false,
  },
  example: { word: "预测", sentence: "这些预测与基准结果一致。", pos: "noun", hint: "此处表示模型预测" },
  reasoning: "off",
  validate(value) { return validatesContextualWordFields(value, ["sentence"]); },
};

const contextualWordEnglish: LlmTaskContract = {
  kind: "contextual-word-english",
  schemaName: "lexiglow_contextual_word_english",
  schema: {
    type: "object",
    properties: { ...wordProperties, english: { type: "string" } },
    required: ["word", "english", "pos", "hint"],
    additionalProperties: false,
  },
  example: { word: "预测", english: "A guess about what will happen next.", pos: "noun", hint: "此处表示模型预测" },
  reasoning: "off",
  validate(value) { return validatesContextualWordFields(value, ["english"]); },
};

const selectionTranslation: LlmTaskContract = {
  kind: "selection-translation",
  schemaName: "lexiglow_selection_translation",
  schema: {
    type: "object",
    properties: { word: { type: "string" } },
    required: ["word"],
    additionalProperties: false,
  },
  example: { word: "所选文本的自然翻译" },
  reasoning: "off",
  validate(value) { return isRecord(value) && nonEmptyString(value.word); },
};

const englishExplanation: LlmTaskContract = {
  kind: "english-explanation",
  schemaName: "lexiglow_english_explanation",
  schema: {
    type: "object",
    properties: { meaning: { type: "string" }, explanation: { type: "string" } },
    required: ["meaning", "explanation"],
    additionalProperties: false,
  },
  example: { meaning: "预测", explanation: "A guess about what will happen next." },
  reasoning: "off",
  validate(value) { return requiresStrings(value, ["meaning", "explanation"]); },
};

const highlightItem = {
  type: "object",
  properties: {
    category: { type: "string", enum: HIGHLIGHT_CATEGORIES },
    tokenIndex: { type: "integer", minimum: 0 },
  },
  required: ["category", "tokenIndex"],
  additionalProperties: false,
};

const clauseBlockItem = {
  type: "object",
  properties: {
    type: { type: "string", enum: CLAUSE_TYPES },
    startToken: { type: "integer", minimum: 0 },
    endToken: { type: "integer", minimum: 0 },
  },
  required: ["type", "startToken", "endToken"],
  additionalProperties: false,
};

function validatesSentenceAnalysis(value: unknown): boolean {
  if (!requiresStrings(value, ["translation", "structure"]) || !isRecord(value)) return false;
  if (!Array.isArray(value.analysisSteps) || value.analysisSteps.length !== 4 || !value.analysisSteps.every(nonEmptyString)) return false;
  if (!Array.isArray(value.highlights) || value.highlights.length < 1 || value.highlights.length > 8) return false;
  if (!value.highlights.every((item) => isRecord(item)
    && typeof item.category === "string"
    && HIGHLIGHT_CATEGORIES.includes(item.category)
    && Number.isInteger(item.tokenIndex))) return false;
  if (!Array.isArray(value.clauseBlocks) || value.clauseBlocks.length < 1 || value.clauseBlocks.length > 10) return false;
  return value.clauseBlocks.every((item) => isRecord(item)
    && typeof item.type === "string"
    && CLAUSE_TYPES.includes(item.type)
    && Number.isInteger(item.startToken)
    && Number.isInteger(item.endToken));
}

const sentenceAnalysis: LlmTaskContract = {
  kind: "sentence-analysis",
  schemaName: "lexiglow_sentence_analysis",
  schema: {
    type: "object",
    properties: {
      translation: { type: "string" },
      structure: { type: "string" },
      analysisSteps: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
      highlights: { type: "array", minItems: 1, maxItems: 8, items: highlightItem },
      clauseBlocks: { type: "array", minItems: 1, maxItems: 10, items: clauseBlockItem },
    },
    required: ["translation", "structure", "analysisSteps", "highlights", "clauseBlocks"],
    additionalProperties: false,
  },
  example: {
    translation: "完整翻译",
    structure: "Models improve.",
    analysisSteps: ["步骤一", "步骤二", "步骤三", "步骤四"],
    highlights: [{ category: "subject", tokenIndex: 0 }],
    clauseBlocks: [{ type: "main", startToken: 0, endToken: 1 }],
  },
  reasoning: "low",
  validate: validatesSentenceAnalysis,
};

const contracts: Record<LlmTaskKind, LlmTaskContract> = {
  "contextual-word": contextualWord,
  "contextual-word-sentence": contextualWordSentence,
  "contextual-word-english": contextualWordEnglish,
  "selection-translation": selectionTranslation,
  "english-explanation": englishExplanation,
  "sentence-analysis": sentenceAnalysis,
};

export function getLlmTaskContract(task: LlmTaskKind): LlmTaskContract {
  return contracts[task];
}
