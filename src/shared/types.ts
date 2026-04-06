export interface UserSettings {
  knownBaseRank: number;
  masteredOverrides: string[];
  unmasteredOverrides: string[];
  ignoredWords: string[];
}

export interface TranslatorSettings {
  providerBaseUrl: string;
  providerModel: string;
  apiKey: string;
  fallbackToGoogle: boolean;
  llmDisplayMode: "word" | "sentence";
}

export interface TranslationResult {
  translation: string;
  sentenceTranslation?: string;
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

export interface SentenceAnalysisResult {
  translation: string;
  structure: string;
  analysisSteps: string[];
  highlights: SentenceHighlight[];
  provider: string;
  cached: boolean;
}

export interface LexiconLookupResult {
  lemma: string;
  surface: string;
  rank: number | null;
  isIgnored: boolean;
  isKnown: boolean;
  shouldTranslate: boolean;
  reason: "ignored" | "known" | "translate" | "invalid";
  translation?: string;
  sentenceTranslation?: string;
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
  provider: string;
  updatedAt: number;
}
