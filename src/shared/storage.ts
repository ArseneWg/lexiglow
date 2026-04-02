import { CACHE_KEY_PREFIX, STORAGE_SETTINGS_KEY, STORAGE_TRANSLATOR_SETTINGS_KEY } from "./constants";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import { DEFAULT_TRANSLATOR_SETTINGS, sanitizeTranslatorSettings } from "./translator";
import type { CacheEntry, TranslatorSettings, UserSettings } from "./types";

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  return sanitizeSettings(result[STORAGE_SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_SETTINGS_KEY]: sanitizeSettings(settings),
  });
}

export async function getTranslatorSettings(): Promise<TranslatorSettings> {
  const result = await chrome.storage.local.get(STORAGE_TRANSLATOR_SETTINGS_KEY);
  return sanitizeTranslatorSettings(
    (result[STORAGE_TRANSLATOR_SETTINGS_KEY] as Partial<TranslatorSettings> | undefined) ??
      DEFAULT_TRANSLATOR_SETTINGS,
  );
}

export async function saveTranslatorSettings(settings: TranslatorSettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_TRANSLATOR_SETTINGS_KEY]: sanitizeTranslatorSettings(settings),
  });
}

function hashContext(contextText: string): string {
  let hash = 2166136261;

  for (let index = 0; index < contextText.length; index += 1) {
    hash ^= contextText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0).toString(36);
}

export function getCacheKey(lemma: string, contextText = "", provider = ""): string {
  return `${CACHE_KEY_PREFIX}${lemma}:${provider}:${hashContext(contextText)}`;
}

export async function getCachedTranslation(
  lemma: string,
  contextText = "",
  provider = "",
): Promise<CacheEntry | null> {
  const key = getCacheKey(lemma, contextText, provider);
  const result = await chrome.storage.local.get(key);
  return (result[key] as CacheEntry | undefined) ?? null;
}

export async function setCachedTranslation(
  lemma: string,
  contextText: string,
  provider: string,
  entry: CacheEntry,
): Promise<void> {
  await chrome.storage.local.set({
    [getCacheKey(lemma, contextText, provider)]: entry,
  });
}
