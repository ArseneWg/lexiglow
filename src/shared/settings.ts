import { DEFAULT_KNOWN_BASE_RANK, MAX_KNOWN_BASE_RANK } from "./constants";
import { BUILTIN_IGNORED_WORDS } from "./ignoredWords";
import { lookupRank, resolveLookupLemma } from "./lexicon";
import type { LearnerLevelBand, UserSettings, WordFlags } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  knownBaseRank: DEFAULT_KNOWN_BASE_RANK,
  masteredOverrides: [],
  unmasteredOverrides: [],
  ignoredWords: [],
};

function uniqueNormalizedWords(words: string[]): string[] {
  return [...new Set(words.map((word) => resolveLookupLemma(word)).filter(Boolean))].sort();
}

export function looksLikeSpecialTerm(surface: string, lemma: string, rank: number | null): boolean {
  if (!surface || !lemma || rank !== null) {
    const trimmedKnown = surface.trim();

    if (/^[A-Z][a-z]{2,}$/.test(trimmedKnown) && rank !== null && rank > 6000) {
      return true;
    }

    return false;
  }

  const trimmed = surface.trim();

  if (/[A-Z].*[A-Z]/.test(trimmed)) {
    return true;
  }

  if (/^[A-Z][a-z]{2,}$/.test(trimmed)) {
    return true;
  }

  if (lemma.length >= 15) {
    return true;
  }

  if (/^[a-z]{3,12}$/i.test(trimmed) && /[bcdfghjklmnpqrstvwxyz]{4,}/i.test(trimmed)) {
    return true;
  }

  if (/^[a-z]{3,8}$/i.test(trimmed) && !/[aeiouy]/i.test(trimmed)) {
    return true;
  }

  return false;
}

export function clampKnownBaseRank(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_KNOWN_BASE_RANK;
  }

  return Math.min(MAX_KNOWN_BASE_RANK, Math.max(0, Math.round(value)));
}

export function sanitizeSettings(input?: Partial<UserSettings> | null): UserSettings {
  const knownBaseRank = clampKnownBaseRank(input?.knownBaseRank ?? DEFAULT_KNOWN_BASE_RANK);
  const ignoredWords = uniqueNormalizedWords(input?.ignoredWords ?? []);
  const ignoredSet = new Set(ignoredWords);

  const masteredOverrides = uniqueNormalizedWords(input?.masteredOverrides ?? []).filter(
    (word) => !ignoredSet.has(word),
  );
  const unmasteredOverrides = uniqueNormalizedWords(input?.unmasteredOverrides ?? []).filter(
    (word) => !ignoredSet.has(word),
  );

  return {
    knownBaseRank,
    masteredOverrides,
    unmasteredOverrides,
    ignoredWords,
  };
}

export function isBuiltinIgnoredWord(lemma: string): boolean {
  return BUILTIN_IGNORED_WORDS.has(lemma);
}

export function resolveWordFlags(
  lemma: string,
  rank: number | null,
  settings: UserSettings,
  surface = lemma,
): WordFlags {
  if (!lemma) {
    return {
      isIgnored: false,
      isKnown: false,
      shouldTranslate: false,
      reason: "invalid",
    };
  }

  const forceUnmastered = settings.unmasteredOverrides.includes(lemma);

  if (forceUnmastered) {
    return {
      isIgnored: false,
      isKnown: false,
      shouldTranslate: true,
      reason: "translate",
    };
  }

  if (isBuiltinIgnoredWord(lemma) || settings.ignoredWords.includes(lemma)) {
    return {
      isIgnored: true,
      isKnown: false,
      shouldTranslate: false,
      reason: "ignored",
    };
  }

  const userMastered = settings.masteredOverrides.includes(lemma);

  if (userMastered) {
    return {
      isIgnored: false,
      isKnown: true,
      shouldTranslate: false,
      reason: "known",
    };
  }

  if (looksLikeSpecialTerm(surface, lemma, rank)) {
    return {
      isIgnored: true,
      isKnown: false,
      shouldTranslate: false,
      reason: "ignored",
    };
  }

  const inKnownBase = rank !== null && rank <= settings.knownBaseRank;
  const isKnown = userMastered || (inKnownBase && !forceUnmastered);

  return {
    isIgnored: false,
    isKnown,
    shouldTranslate: !isKnown,
    reason: isKnown ? "known" : "translate",
  };
}

export function setWordMastered(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveLookupLemma(lemma);

  if (!normalized) {
    return settings;
  }

  return sanitizeSettings({
    ...settings,
    masteredOverrides: [...settings.masteredOverrides, normalized],
    unmasteredOverrides: settings.unmasteredOverrides.filter((word) => word !== normalized),
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
  });
}

export function setWordUnmastered(
  settings: UserSettings,
  lemma: string,
  rank: number | null,
): UserSettings {
  const normalized = resolveLookupLemma(lemma);

  if (!normalized) {
    return settings;
  }

  const nextMastered = settings.masteredOverrides.filter((word) => word !== normalized);
  const nextUnmastered = [...settings.unmasteredOverrides, normalized];

  return sanitizeSettings({
    ...settings,
    masteredOverrides: nextMastered,
    unmasteredOverrides: nextUnmastered,
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
  });
}

export function setWordIgnored(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveLookupLemma(lemma);

  if (!normalized) {
    return settings;
  }

  return sanitizeSettings({
    ...settings,
    masteredOverrides: settings.masteredOverrides.filter((word) => word !== normalized),
    unmasteredOverrides: settings.unmasteredOverrides.filter((word) => word !== normalized),
    ignoredWords: [...settings.ignoredWords, normalized],
  });
}

export function removeWordIgnored(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveLookupLemma(lemma);

  if (!normalized) {
    return settings;
  }

  return sanitizeSettings({
    ...settings,
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
  });
}

export function updateKnownBaseRank(settings: UserSettings, knownBaseRank: number): UserSettings {
  return sanitizeSettings({
    ...settings,
    knownBaseRank,
  });
}

export function clearLearningProgress(settings: UserSettings): UserSettings {
  return sanitizeSettings({
    knownBaseRank: settings.knownBaseRank,
    masteredOverrides: [],
    unmasteredOverrides: [],
    ignoredWords: [],
  });
}

export function countExtraMastered(settings: UserSettings): number {
  let total = 0;

  for (const lemma of settings.masteredOverrides) {
    const rank = lookupRank(lemma);

    if (rank === null || rank > settings.knownBaseRank) {
      total += 1;
    }
  }

  return total;
}

export function countTotalKnown(settings: UserSettings): number {
  let basePenalty = 0;

  for (const lemma of settings.unmasteredOverrides) {
    const rank = lookupRank(lemma);

    if (rank !== null && rank <= settings.knownBaseRank) {
      basePenalty += 1;
    }
  }

  return settings.knownBaseRank - basePenalty + countExtraMastered(settings);
}

export function estimateLearnerLevel(settings: UserSettings): LearnerLevelBand {
  const knownCount = countTotalKnown(settings);

  if (knownCount <= 1500) {
    return "A1";
  }

  if (knownCount <= 3000) {
    return "A2";
  }

  if (knownCount <= 5000) {
    return "B1";
  }

  if (knownCount <= 8000) {
    return "B2";
  }

  return "C1";
}
