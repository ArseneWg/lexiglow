export interface LearningProgressEntry {
  status: "learning" | "known" | "ignored";
  familiarity: number;
  exposures: number;
  successes: number;
  lastSeenAt?: number;
  nextReviewAt?: number;
}

export interface UserSettings {
  schemaVersion: number;
  knownBaseRank: number;
  masteredOverrides: string[];
  unmasteredOverrides: string[];
  ignoredWords: string[];
  wordReviewTrigger: "doubleClick" | "selection";
  learningProgress: Record<string, LearningProgressEntry>;
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

export interface TranslatorProfile extends TranslatorSettings {
  id: string;
  name: string;
}

export interface TranslatorSettingsState {
  activeProfileId: string;
  profiles: TranslatorProfile[];
}

export type LearnerLevelBand = "A1" | "A2" | "B1" | "B2" | "C1";
export type HighlightIntensity = "strong" | "normal" | "weak" | "none";

export interface AlternativeMeaning {
  meaning: string;
  semanticHint?: string;
  partOfSpeech?: string;
}

export interface TranslationResult {
  translation: string;
  sentenceTranslation?: string;
  englishExplanation?: string;
  contextualPartOfSpeech?: string;
  semanticHint?: string;
  alternativeMeanings?: AlternativeMeaning[];
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
export type PronunciationSource = "kaikki" | "cmudict" | "britfone" | "morphology" | "curated";
export type PronunciationConfidence = "context-exact" | "exact" | "derived" | "ambiguous" | "tts-only";
export type PronunciationMorphology = "s-ending" | "past-ed" | "progressive-ing";

export interface PronunciationAudioInfo {
  url: string;
  audioIpa?: string;
  sourcePage?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
}

export interface PronunciationVariant {
  id: string;
  accent: PronunciationAccent | "en";
  ipa?: string;
  audio?: PronunciationAudioInfo;
  partOfSpeech?: string;
  tags?: string[];
  source: PronunciationSource;
  derivedFrom?: string;
  morphology?: PronunciationMorphology;
}

export interface PronunciationResult {
  surface: string;
  variants: PronunciationVariant[];
  selectedVariantIds?: Partial<Record<PronunciationAccent, string>>;
  confidence: PronunciationConfidence;
  ttsAllowed: boolean;
  dataRevision: string;
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
  tokenIndex?: number;
  start?: number;
  end?: number;
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
  wordFormLabel?: string;
  semanticHint?: string;
  alternativeMeanings?: AlternativeMeaning[];
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
  semanticHint?: string;
  alternativeMeanings?: AlternativeMeaning[];
  provider: string;
  updatedAt: number;
}

export interface PronunciationCacheEntry {
  surface: string;
  variants: PronunciationVariant[];
  selectedVariantIds?: Partial<Record<PronunciationAccent, string>>;
  confidence: PronunciationConfidence;
  ttsAllowed: boolean;
  dataRevision: string;
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
