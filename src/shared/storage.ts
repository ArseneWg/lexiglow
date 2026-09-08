import { STORAGE_SETTINGS_KEY, STORAGE_TRANSLATOR_SETTINGS_KEY } from "./constants";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import {
  DEFAULT_TRANSLATOR_PROFILE,
  DEFAULT_TRANSLATOR_SETTINGS,
  DEFAULT_TRANSLATOR_SETTINGS_STATE,
  resolveActiveTranslatorProfile,
  sanitizeTranslatorSettings,
  sanitizeTranslatorSettingsState,
} from "./translator";
import type {
  TranslatorProfile,
  TranslatorSettings,
  TranslatorSettingsState,
  UserSettings,
} from "./types";

const TRANSLATOR_SECRET_DB_NAME = "lexiglow-secrets";
const TRANSLATOR_SECRET_DB_VERSION = 1;
const TRANSLATOR_SECRET_STORE_NAME = "translator-api-keys";

let memorySecretOwner: unknown;
const memorySecrets = new Map<string, string>();

function isTrustedExtensionContext(): boolean {
  const protocol = globalThis.location?.protocol;
  return protocol === undefined || protocol === "chrome-extension:";
}

function currentMemorySecrets(): Map<string, string> {
  const owner = globalThis.chrome;

  if (memorySecretOwner !== owner) {
    memorySecretOwner = owner;
    memorySecrets.clear();
  }

  return memorySecrets;
}

function canUseSecretDatabase(): boolean {
  return isTrustedExtensionContext() && typeof globalThis.indexedDB !== "undefined";
}

function openSecretDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(
      TRANSLATOR_SECRET_DB_NAME,
      TRANSLATOR_SECRET_DB_VERSION,
    );

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TRANSLATOR_SECRET_STORE_NAME)) {
        database.createObjectStore(TRANSLATOR_SECRET_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open translator secret store."));
  });
}

async function readTranslatorSecret(profileId: string): Promise<string> {
  if (!canUseSecretDatabase()) {
    return currentMemorySecrets().get(profileId) ?? "";
  }

  const database = await openSecretDatabase();

  try {
    return await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction(TRANSLATOR_SECRET_STORE_NAME, "readonly");
      const request = transaction.objectStore(TRANSLATOR_SECRET_STORE_NAME).get(profileId);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : "");
      request.onerror = () => reject(request.error ?? new Error("Failed to read translator API key."));
    });
  } finally {
    database.close();
  }
}

async function writeTranslatorSecret(profileId: string, apiKey: string): Promise<void> {
  const normalized = apiKey.trim();

  if (!canUseSecretDatabase()) {
    const secrets = currentMemorySecrets();
    if (normalized) {
      secrets.set(profileId, normalized);
    } else {
      secrets.delete(profileId);
    }
    return;
  }

  const database = await openSecretDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TRANSLATOR_SECRET_STORE_NAME, "readwrite");
      const store = transaction.objectStore(TRANSLATOR_SECRET_STORE_NAME);
      if (normalized) {
        store.put(normalized, profileId);
      } else {
        store.delete(profileId);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to write translator API key."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Translator API key write was aborted."));
    });
  } finally {
    database.close();
  }
}

async function replaceTranslatorSecrets(profiles: TranslatorProfile[]): Promise<void> {
  if (!canUseSecretDatabase()) {
    const secrets = currentMemorySecrets();
    secrets.clear();
    for (const profile of profiles) {
      if (profile.apiKey.trim()) {
        secrets.set(profile.id, profile.apiKey.trim());
      }
    }
    return;
  }

  const database = await openSecretDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TRANSLATOR_SECRET_STORE_NAME, "readwrite");
      const store = transaction.objectStore(TRANSLATOR_SECRET_STORE_NAME);
      store.clear();
      for (const profile of profiles) {
        const apiKey = profile.apiKey.trim();
        if (apiKey) {
          store.put(apiKey, profile.id);
        }
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Failed to replace translator API keys."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Translator API key update was aborted."));
    });
  } finally {
    database.close();
  }
}

function stripProfileSecret(profile: TranslatorProfile): TranslatorProfile {
  return {
    ...profile,
    apiKey: "",
  };
}

function stripStateSecrets(state: TranslatorSettingsState): TranslatorSettingsState {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map(stripProfileSecret),
  };
}

async function hydrateStateSecrets(state: TranslatorSettingsState): Promise<TranslatorSettingsState> {
  if (!isTrustedExtensionContext()) {
    return stripStateSecrets(state);
  }

  const profiles = await Promise.all(
    state.profiles.map(async (profile) => ({
      ...profile,
      apiKey: await readTranslatorSecret(profile.id),
    })),
  );

  return {
    activeProfileId: state.activeProfileId,
    profiles,
  };
}

async function migrateLegacyProfileSecrets(state: TranslatorSettingsState): Promise<TranslatorSettingsState> {
  if (!isTrustedExtensionContext()) {
    return stripStateSecrets(state);
  }

  const legacyProfiles = state.profiles.filter((profile) => profile.apiKey.trim());

  if (!legacyProfiles.length) {
    return state;
  }

  for (const profile of legacyProfiles) {
    await writeTranslatorSecret(profile.id, profile.apiKey);
  }

  const publicState = stripStateSecrets(state);
  await chrome.storage.local.set({
    [STORAGE_TRANSLATOR_SETTINGS_KEY]: publicState,
  });
  return publicState;
}

function normalizeStoredTranslatorState(raw: unknown): TranslatorSettingsState {
  if (raw && typeof raw === "object" && "profiles" in (raw as Record<string, unknown>)) {
    return sanitizeTranslatorSettingsState(raw as Partial<TranslatorSettingsState>);
  }

  const settings = sanitizeTranslatorSettings(
    (raw as Partial<TranslatorSettings> | undefined) ?? DEFAULT_TRANSLATOR_SETTINGS,
  );

  return sanitizeTranslatorSettingsState({
    activeProfileId: DEFAULT_TRANSLATOR_PROFILE.id,
    profiles: [
      {
        ...DEFAULT_TRANSLATOR_PROFILE,
        ...settings,
      },
    ],
  });
}

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
  const state = await getTranslatorSettingsState();
  return resolveActiveTranslatorProfile(state);
}

export async function getTranslatorSettingsState(): Promise<TranslatorSettingsState> {
  const result = await chrome.storage.local.get(STORAGE_TRANSLATOR_SETTINGS_KEY);
  const raw = result[STORAGE_TRANSLATOR_SETTINGS_KEY];
  const normalized = raw === undefined
    ? sanitizeTranslatorSettingsState(DEFAULT_TRANSLATOR_SETTINGS_STATE)
    : normalizeStoredTranslatorState(raw);
  const publicState = await migrateLegacyProfileSecrets(normalized);
  return hydrateStateSecrets(publicState);
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

  await saveTranslatorSettingsState({
    activeProfileId: activeProfile.id,
    profiles,
  });
}

export async function saveTranslatorSettingsState(state: TranslatorSettingsState): Promise<void> {
  const sanitized = sanitizeTranslatorSettingsState(state);

  if (isTrustedExtensionContext()) {
    await replaceTranslatorSecrets(sanitized.profiles);
  }

  await chrome.storage.local.set({
    [STORAGE_TRANSLATOR_SETTINGS_KEY]: stripStateSecrets(sanitized),
  });
}
