import { DEFAULT_KNOWN_BASE_RANK, MAX_KNOWN_BASE_RANK } from "./constants";
import { BUILTIN_IGNORED_WORDS } from "./ignoredWords";
import { lookupRank, resolveMasteryKey } from "./lexicon";
import type { LearnerLevelBand, UserSettings, WordFlags } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  knownBaseRank: DEFAULT_KNOWN_BASE_RANK,
  masteredOverrides: [],
  unmasteredOverrides: [],
  ignoredWords: [],
};

const PINYIN_INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
  "y",
  "w",
  "",
] as const;

const PINYIN_FINALS = [
  "iang",
  "iong",
  "uang",
  "uai",
  "iao",
  "ian",
  "ing",
  "ang",
  "eng",
  "ong",
  "uan",
  "ie",
  "iu",
  "ui",
  "ua",
  "uo",
  "ue",
  "un",
  "in",
  "ai",
  "ei",
  "ao",
  "ou",
  "an",
  "en",
  "er",
  "a",
  "o",
  "e",
  "i",
  "u",
  "v",
] as const;

function consumePinyinSyllable(token: string, start: number): number {
  for (const initial of PINYIN_INITIALS) {
    if (initial && !token.startsWith(initial, start)) {
      continue;
    }

    const afterInitial = start + initial.length;

    for (const final of PINYIN_FINALS) {
      if (token.startsWith(final, afterInitial)) {
        return afterInitial + final.length;
      }
    }
  }

  return -1;
}

function looksLikePinyin(surface: string): boolean {
  const token = surface.trim().toLowerCase();

  if (!/^[a-z]+$/.test(token) || token.length < 2 || token.length > 12) {
    return false;
  }

  let cursor = 0;
  let syllableCount = 0;
  let hasStrongMarker = false;

  while (cursor < token.length && syllableCount < 6) {
    const next = consumePinyinSyllable(token, cursor);

    if (next <= cursor) {
      return false;
    }

    const syllable = token.slice(cursor, next);

    if (/^(zh|ch|sh|x|q|j|r|y|w)/.test(syllable)) {
      hasStrongMarker = true;
    }

    cursor = next;
    syllableCount += 1;
  }

  // We only suppress reminders for strings that are clearly romanized Chinese,
  // not for every accidental English-looking fragment.
  return cursor === token.length && hasStrongMarker && syllableCount >= 1;
}

function uniqueNormalizedWords(words: string[]): string[] {
  return [...new Set(words.map((word) => resolveMasteryKey(word)).filter(Boolean))].sort();
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

  if (looksLikePinyin(trimmed)) {
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
  const masteryKey = resolveMasteryKey(surface || lemma);

  if (!lemma || !masteryKey) {
    return {
      isIgnored: false,
      isKnown: false,
      shouldTranslate: false,
      reason: "invalid",
    };
  }

  const forceUnmastered = settings.unmasteredOverrides.includes(masteryKey);

  if (forceUnmastered) {
    return {
      isIgnored: false,
      isKnown: false,
      shouldTranslate: true,
      reason: "translate",
    };
  }

  if (isBuiltinIgnoredWord(masteryKey) || settings.ignoredWords.includes(masteryKey)) {
    return {
      isIgnored: true,
      isKnown: false,
      shouldTranslate: false,
      reason: "ignored",
    };
  }

  const userMastered = settings.masteredOverrides.includes(masteryKey);

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
  const normalized = resolveMasteryKey(lemma);

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
  const normalized = resolveMasteryKey(lemma);

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
  const normalized = resolveMasteryKey(lemma);

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
  const normalized = resolveMasteryKey(lemma);

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
