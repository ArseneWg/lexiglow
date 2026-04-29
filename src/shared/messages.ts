import type {
  LexiconLookupResult,
  PronunciationAccent,
  PronunciationResult,
  SentenceAnalysisResult,
  SelectionTranslationResult,
  TranslatorSettings,
  TranslatorSettingsState,
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

export interface GetTranslatorSettingsStateMessage {
  type: "GET_TRANSLATOR_SETTINGS_STATE";
}

export interface SaveTranslatorSettingsMessage {
  type: "SAVE_TRANSLATOR_SETTINGS";
  payload: {
    settings: TranslatorSettings;
  };
}

export interface SaveTranslatorSettingsStateMessage {
  type: "SAVE_TRANSLATOR_SETTINGS_STATE";
  payload: {
    state: TranslatorSettingsState;
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

export interface SpeakPronunciationMessage {
  type: "SPEAK_PRONUNCIATION";
  payload: {
    text: string;
    accent: PronunciationAccent;
  };
}

export interface LookupPronunciationMessage {
  type: "LOOKUP_PRONUNCIATION";
  payload: {
    surface: string;
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
  | GetTranslatorSettingsStateMessage
  | SaveTranslatorSettingsMessage
  | SaveTranslatorSettingsStateMessage
  | TranslateWordMessage
  | AnalyzeSelectionMessage
  | TranslateSelectionMessage
  | SpeakPronunciationMessage
  | LookupPronunciationMessage;

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

export interface TranslatorSettingsStateResponse {
  ok: boolean;
  state?: TranslatorSettingsState;
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

export interface PronunciationResponse {
  ok: boolean;
  error?: string;
}

export interface PronunciationLookupResponse {
  ok: boolean;
  result?: PronunciationResult;
  error?: string;
}
