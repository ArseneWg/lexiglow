import type {
  LexiconLookupResult,
  SentenceAnalysisResult,
  SelectionTranslationResult,
  TranslatorSettings,
  UserSettings,
} from "./types";

export type TranslationProviderChoice = "google" | "llm";

export interface LookupWordMessage {
  type: "LOOKUP_WORD";
  payload: {
    surface: string;
    forceTranslate?: boolean;
    contextText?: string;
  };
}

export interface SetWordMasteredMessage {
  type: "SET_WORD_MASTERED";
  payload: {
    lemma: string;
  };
}

export interface SetWordUnmasteredMessage {
  type: "SET_WORD_UNMASTERED";
  payload: {
    lemma: string;
    rank: number | null;
  };
}

export interface SetWordIgnoredMessage {
  type: "SET_WORD_IGNORED";
  payload: {
    lemma: string;
  };
}

export interface RemoveWordIgnoredMessage {
  type: "REMOVE_WORD_IGNORED";
  payload: {
    lemma: string;
  };
}

export interface UpdateBaseRankMessage {
  type: "UPDATE_BASE_RANK";
  payload: {
    knownBaseRank: number;
  };
}

export interface GetSettingsMessage {
  type: "GET_SETTINGS";
}

export interface GetTranslatorSettingsMessage {
  type: "GET_TRANSLATOR_SETTINGS";
}

export interface SaveTranslatorSettingsMessage {
  type: "SAVE_TRANSLATOR_SETTINGS";
  payload: {
    settings: TranslatorSettings;
  };
}

export interface TranslateWordMessage {
  type: "TRANSLATE_WORD";
  payload: {
    surface: string;
    contextText?: string;
    provider: TranslationProviderChoice;
    forceTranslate?: boolean;
  };
}

export interface AnalyzeSelectionMessage {
  type: "ANALYZE_SELECTION";
  payload: {
    text: string;
  };
}

export interface TranslateSelectionMessage {
  type: "TRANSLATE_SELECTION";
  payload: {
    text: string;
    contextText?: string;
    provider: TranslationProviderChoice;
  };
}

export type RuntimeMessage =
  | LookupWordMessage
  | SetWordMasteredMessage
  | SetWordUnmasteredMessage
  | SetWordIgnoredMessage
  | RemoveWordIgnoredMessage
  | UpdateBaseRankMessage
  | GetSettingsMessage
  | GetTranslatorSettingsMessage
  | SaveTranslatorSettingsMessage
  | TranslateWordMessage
  | AnalyzeSelectionMessage
  | TranslateSelectionMessage;

export interface LookupWordResponse {
  ok: boolean;
  result?: LexiconLookupResult;
  error?: string;
}

export interface SettingsResponse {
  ok: boolean;
  settings?: UserSettings;
  error?: string;
}

export interface TranslatorSettingsResponse {
  ok: boolean;
  settings?: TranslatorSettings;
  error?: string;
}

export interface SentenceAnalysisResponse {
  ok: boolean;
  result?: SentenceAnalysisResult;
  error?: string;
}

export interface SelectionTranslationResponse {
  ok: boolean;
  result?: SelectionTranslationResult;
  error?: string;
}
