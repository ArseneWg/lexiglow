import type { LexiconLookupResult, UserSettings } from "./types";

export interface LookupWordMessage {
  type: "LOOKUP_WORD";
  payload: {
    surface: string;
    forceTranslate?: boolean;
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

export type RuntimeMessage =
  | LookupWordMessage
  | SetWordMasteredMessage
  | SetWordUnmasteredMessage
  | SetWordIgnoredMessage
  | RemoveWordIgnoredMessage
  | UpdateBaseRankMessage
  | GetSettingsMessage;

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
