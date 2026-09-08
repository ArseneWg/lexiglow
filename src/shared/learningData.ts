import { sanitizeSettings } from "./settings";
import {
  DEFAULT_TRANSLATOR_SETTINGS_STATE,
  sanitizeTranslatorSettingsState,
} from "./translator";
import type {
  TranslatorProfile,
  TranslatorSettingsState,
  UserSettings,
} from "./types";

export const LEARNING_DATA_FORMAT = "lexiglow-learning-data";
export const LEARNING_DATA_EXPORT_VERSION = 1;
export const MAX_LEARNING_DATA_IMPORT_BYTES = 5_000_000;

export interface LearningDataExportBundle {
  format: typeof LEARNING_DATA_FORMAT;
  exportVersion: typeof LEARNING_DATA_EXPORT_VERSION;
  exportedAt: string;
  userSettings: UserSettings;
  translatorSettingsState: TranslatorSettingsState;
}

function stripProfileSecret(profile: TranslatorProfile): TranslatorProfile {
  return {
    ...profile,
    apiKey: "",
  };
}

function stripTranslatorSecrets(state: TranslatorSettingsState): TranslatorSettingsState {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map(stripProfileSecret),
  };
}

function parseUnknownJson(input: string | unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  if (new TextEncoder().encode(input).byteLength > MAX_LEARNING_DATA_IMPORT_BYTES) {
    throw new Error("Learning data file is too large.");
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new Error("Learning data file is not valid JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createLearningDataExport(
  userSettings: UserSettings,
  translatorSettingsState: TranslatorSettingsState,
  exportedAt = new Date().toISOString(),
): LearningDataExportBundle {
  return {
    format: LEARNING_DATA_FORMAT,
    exportVersion: LEARNING_DATA_EXPORT_VERSION,
    exportedAt,
    userSettings: sanitizeSettings(userSettings),
    translatorSettingsState: stripTranslatorSecrets(
      sanitizeTranslatorSettingsState(translatorSettingsState),
    ),
  };
}

export function serializeLearningDataExport(bundle: LearningDataExportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseLearningDataExport(input: string | unknown): LearningDataExportBundle {
  const raw = parseUnknownJson(input);

  if (!isRecord(raw)) {
    throw new Error("Learning data file has an invalid root object.");
  }
  if (raw.format !== LEARNING_DATA_FORMAT) {
    throw new Error("This file is not a LexiGlow learning-data export.");
  }
  if (raw.exportVersion !== LEARNING_DATA_EXPORT_VERSION) {
    throw new Error("This learning-data export version is not supported.");
  }
  if (!isRecord(raw.userSettings)) {
    throw new Error("Learning data file is missing user settings.");
  }

  const translatorState = isRecord(raw.translatorSettingsState)
    ? sanitizeTranslatorSettingsState(raw.translatorSettingsState)
    : sanitizeTranslatorSettingsState(DEFAULT_TRANSLATOR_SETTINGS_STATE);

  return {
    format: LEARNING_DATA_FORMAT,
    exportVersion: LEARNING_DATA_EXPORT_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    userSettings: sanitizeSettings(raw.userSettings),
    translatorSettingsState: stripTranslatorSecrets(translatorState),
  };
}

export function mergeImportedTranslatorSecrets(
  importedState: TranslatorSettingsState,
  currentState: TranslatorSettingsState,
): TranslatorSettingsState {
  const existingSecrets = new Map(
    currentState.profiles.map((profile) => [profile.id, profile.apiKey.trim()]),
  );
  const imported = sanitizeTranslatorSettingsState(importedState);

  return {
    activeProfileId: imported.activeProfileId,
    profiles: imported.profiles.map((profile) => ({
      ...profile,
      apiKey: existingSecrets.get(profile.id) ?? "",
    })),
  };
}
