export interface UserSettings {
  knownBaseRank: number;
  masteredOverrides: string[];
  unmasteredOverrides: string[];
  ignoredWords: string[];
}

export type SupportedLearnerLanguageCode =
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es"
  | "pt-BR"
  | "ru"
  | "it"
  | "tr"
  | "vi"
  | "id"
  | "th"
  | "ar";

export interface TranslatorSettings {
  defaultTranslationProvider: "google" | "llm";
  llmProvider: "openai" | "gemini" | "claude";
  providerBaseUrl: string;
  providerModel: string;
  apiKey: string;
  fallbackToGoogle: boolean;
  learnerLanguageCode: SupportedLearnerLanguageCode;
  llmDisplayMode: "word" | "sentence" | "english";
  cacheDurationValue: number;
  cacheDurationUnit: "minutes" | "hours";
}

export type LearnerLevelBand = "A1" | "A2" | "B1" | "B2" | "C1";

export interface TranslationResult {
  translation: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
  contextualPartOfSpeech?: string;
  provider: string;
  cached: boolean;
}

export interface SelectionTranslationResult {
  text: string;
  translation: string;
  sentenceTranslation?: string;
  translationProvider: string;
  cached: boolean;
}

export interface EnglishExplanationResult {
  meaning: string;
  explanation: string;
  provider: string;
  cached: boolean;
}

export type PronunciationAccent = "en-GB" | "en-US";

export interface PronunciationResult {
  ukPhonetic?: string;
  usPhonetic?: string;
  ukAudioUrl?: string;
  usAudioUrl?: string;
  cached: boolean;
}

export type SentenceHighlightCategory =
  | "subject"
  | "predicate"
  | "nonfinite"
  | "conjunction"
  | "relative"
  | "preposition";

export interface SentenceHighlight {
  text: string;
  category: SentenceHighlightCategory;
}

export type SentenceClauseBlockType =
  | "main"
  | "relative"
  | "subordinate"
  | "nonfinite"
  | "parallel"
  | "modifier";

export interface SentenceClauseBlock {
  text: string;
  type: SentenceClauseBlockType;
  label?: string;
}

export interface SentenceAnalysisResult {
  translation: string;
  structure: string;
  analysisSteps: string[];
  highlights: SentenceHighlight[];
  clauseBlocks: SentenceClauseBlock[];
  provider: string;
  cached: boolean;
}

export interface SentenceAnalysisCacheEntry {
  translation: string;
  structure: string;
  analysisSteps: string[];
  highlights: SentenceHighlight[];
  clauseBlocks: SentenceClauseBlock[];
  provider: string;
  updatedAt: number;
}

export interface LexiconLookupResult {
  lemma: string;
  surface: string;
  partOfSpeech?: string;
  contextualPartOfSpeech?: string;
  rank: number | null;
  isIgnored: boolean;
  isKnown: boolean;
  shouldTranslate: boolean;
  reason: "ignored" | "known" | "translate" | "invalid";
  translation?: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
  translationProvider?: string;
  cached?: boolean;
}

export interface WordFlags {
  isIgnored: boolean;
  isKnown: boolean;
  shouldTranslate: boolean;
  reason: LexiconLookupResult["reason"];
}

export interface CacheEntry {
  translation: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
  contextualPartOfSpeech?: string;
  provider: string;
  updatedAt: number;
}

export interface PronunciationCacheEntry {
  ukPhonetic?: string;
  usPhonetic?: string;
  ukAudioUrl?: string;
  usAudioUrl?: string;
  updatedAt: number;
}

export interface EnglishExplanationCacheEntry {
  meaning: string;
  explanation: string;
  provider: string;
  updatedAt: number;
}
