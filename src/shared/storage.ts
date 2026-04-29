import { STORAGE_SETTINGS_KEY, STORAGE_TRANSLATOR_SETTINGS_KEY } from "./constants";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import {
  DEFAULT_TRANSLATOR_SETTINGS,
  DEFAULT_TRANSLATOR_SETTINGS_STATE,
  resolveActiveTranslatorProfile,
  sanitizeTranslatorSettings,
  sanitizeTranslatorSettingsState,
} from "./translator";
import type {
  TranslatorSettings,
  TranslatorSettingsState,
  UserSettings,
} from "./types";

export async function getSettings(): Promise<UserSettings> {
  const localResult = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  const localSettings = localResult[STORAGE_SETTINGS_KEY] as Partial<UserSettings> | undefined;

  if (localSettings) {
    return sanitizeSettings(localSettings);
  }

  const syncResult = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  const legacySettings = syncResult[STORAGE_SETTINGS_KEY] as Partial<UserSettings> | undefined;
  const sanitized = sanitizeSettings(legacySettings ?? DEFAULT_SETTINGS);

  if (legacySettings) {
    await chrome.storage.local.set({
      [STORAGE_SETTINGS_KEY]: sanitized,
    });
  }

  return sanitized;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_SETTINGS_KEY]: sanitizeSettings(settings),
  });
}

export async function getTranslatorSettings(): Promise<TranslatorSettings> {
  const result = await chrome.storage.local.get(STORAGE_TRANSLATOR_SETTINGS_KEY);
  const raw = result[STORAGE_TRANSLATOR_SETTINGS_KEY];

  if (raw && typeof raw === "object" && "profiles" in (raw as Record<string, unknown>)) {
    return resolveActiveTranslatorProfile(
      sanitizeTranslatorSettingsState(raw as Partial<TranslatorSettingsState>),
    );
  }

  return sanitizeTranslatorSettings(
    (raw as Partial<TranslatorSettings> | undefined) ?? DEFAULT_TRANSLATOR_SETTINGS,
  );
}

export async function getTranslatorSettingsState(): Promise<TranslatorSettingsState> {
  const result = await chrome.storage.local.get(STORAGE_TRANSLATOR_SETTINGS_KEY);
  const raw = result[STORAGE_TRANSLATOR_SETTINGS_KEY];

  if (raw && typeof raw === "object" && "profiles" in (raw as Record<string, unknown>)) {
    return sanitizeTranslatorSettingsState(raw as Partial<TranslatorSettingsState>);
  }

  return sanitizeTranslatorSettingsState(DEFAULT_TRANSLATOR_SETTINGS_STATE);
}

export async function saveTranslatorSettings(settings: TranslatorSettings): Promise<void> {
  const state = await getTranslatorSettingsState();
  const activeProfile = resolveActiveTranslatorProfile(state);
  const profiles = state.profiles.map((profile) =>
    profile.id === activeProfile.id
      ? {
        ...profile,
        ...sanitizeTranslatorSettings(settings),
      }
      : profile);

  await chrome.storage.local.set({
    [STORAGE_TRANSLATOR_SETTINGS_KEY]: sanitizeTranslatorSettingsState({
      activeProfileId: activeProfile.id,
      profiles,
    }),
  });
}

export async function saveTranslatorSettingsState(state: TranslatorSettingsState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_TRANSLATOR_SETTINGS_KEY]: sanitizeTranslatorSettingsState(state),
  });
}
