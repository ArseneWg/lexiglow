import { CACHE_KEY_PREFIX, STORAGE_SETTINGS_KEY } from "./constants";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";
import type { CacheEntry, UserSettings } from "./types";

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_SETTINGS_KEY);
  return sanitizeSettings(result[STORAGE_SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({
    [STORAGE_SETTINGS_KEY]: sanitizeSettings(settings),
  });
}

export function getCacheKey(lemma: string): string {
  return `${CACHE_KEY_PREFIX}${lemma}`;
}

export async function getCachedTranslation(lemma: string): Promise<CacheEntry | null> {
  const key = getCacheKey(lemma);
  const result = await chrome.storage.local.get(key);
  return (result[key] as CacheEntry | undefined) ?? null;
}

export async function setCachedTranslation(lemma: string, entry: CacheEntry): Promise<void> {
  await chrome.storage.local.set({
    [getCacheKey(lemma)]: entry,
  });
}
