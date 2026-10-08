import { normalizeBaseUrl } from "./llm/providerUtils";
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

export class LearningDataImportError extends Error {
  constructor(public readonly code: "tooLarge" | "invalidJson" | "invalidFormat" | "unsupportedVersion", message: string) {
    super(message);
    this.name = "LearningDataImportError";
  }
}

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
    throw new LearningDataImportError("tooLarge", "Learning data file is too large.");
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new LearningDataImportError("invalidJson", "Learning data file is not valid JSON.");
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
    throw new LearningDataImportError("invalidFormat", "Learning data file has an invalid root object.");
  }
  if (raw.format !== LEARNING_DATA_FORMAT) {
    throw new LearningDataImportError("invalidFormat", "This file is not a LexiGlow learning-data export.");
  }
  if (raw.exportVersion !== LEARNING_DATA_EXPORT_VERSION) {
    throw new LearningDataImportError("unsupportedVersion", "This learning-data export version is not supported.");
  }
  if (!isRecord(raw.userSettings)) {
    throw new LearningDataImportError("invalidFormat", "Learning data file is missing user settings.");
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
  const existingProfiles = new Map(
    sanitizeTranslatorSettingsState(currentState).profiles.map((profile) => [profile.id, profile]),
  );
  const imported = sanitizeTranslatorSettingsState(importedState);

  return {
    activeProfileId: imported.activeProfileId,
    profiles: imported.profiles.map((profile) => {
      const existing = existingProfiles.get(profile.id);
      // A matching ID is insufficient: an imported endpoint must never inherit
      // credentials intended for another provider or destination.
      const sameDestination = existing?.llmProvider === profile.llmProvider
        && normalizeBaseUrl(existing.providerBaseUrl) === normalizeBaseUrl(profile.providerBaseUrl);
      return { ...profile, apiKey: sameDestination ? existing.apiKey.trim() : "" };
    }),
  };
}
