export interface UserSettings {
  knownBaseRank: number;
  masteredOverrides: string[];
  unmasteredOverrides: string[];
  ignoredWords: string[];
}

export interface TranslationResult {
  translation: string;
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
  provider: string;
  updatedAt: number;
}
