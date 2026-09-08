import { DEFAULT_KNOWN_BASE_RANK, MAX_KNOWN_BASE_RANK } from "./constants";
import { BUILTIN_IGNORED_WORDS } from "./ignoredWords";
import { lookupRank, resolveMasteryKey } from "./lexicon";
import type {
  HighlightIntensity,
  LearnerLevelBand,
  LearningProgressEntry,
  UserSettings,
  WordFlags,
} from "./types";

export const CURRENT_USER_SETTINGS_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: CURRENT_USER_SETTINGS_SCHEMA_VERSION,
  knownBaseRank: DEFAULT_KNOWN_BASE_RANK,
  masteredOverrides: [],
  unmasteredOverrides: [],
  ignoredWords: [],
  wordReviewTrigger: "doubleClick",
  learningProgress: {},
};

const EXPOSURE_WRITE_THROTTLE_MS = 6 * 60 * 60 * 1000;
const MAX_REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

interface MembershipIndex {
  mastered: Set<string>;
  unmastered: Set<string>;
  ignored: Set<string>;
}

const membershipCache = new WeakMap<UserSettings, MembershipIndex>();

function getMembershipIndex(settings: UserSettings): MembershipIndex {
  const cached = membershipCache.get(settings);
  if (cached) {
    return cached;
  }

  const index = {
    mastered: new Set(settings.masteredOverrides),
    unmastered: new Set(settings.unmasteredOverrides),
    ignored: new Set(settings.ignoredWords),
  };
  membershipCache.set(settings, index);
  return index;
}

const PINYIN_INITIALS = [
  "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
  "j", "q", "x", "r", "z", "c", "s", "y", "w", "",
] as const;

const PINYIN_FINALS = [
  "iang", "iong", "uang", "uai", "iao", "ian", "ing", "ang", "eng", "ong", "uan",
  "ie", "iu", "ui", "ua", "uo", "ue", "un", "in", "ai", "ei", "ao", "ou", "an",
  "en", "er", "a", "o", "e", "i", "u", "v",
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

  return cursor === token.length && hasStrongMarker && syllableCount >= 1;
}

function uniqueNormalizedWords(words: string[]): string[] {
  return [...new Set(words.map((word) => resolveMasteryKey(word)).filter(Boolean))].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function sanitizeLearningProgress(
  input: UserSettings["learningProgress"] | undefined,
): Record<string, LearningProgressEntry> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const output: Record<string, LearningProgressEntry> = {};
  for (const [rawKey, rawEntry] of Object.entries(input)) {
    const key = resolveMasteryKey(rawKey);
    if (!key || !rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const status = rawEntry.status === "known" || rawEntry.status === "ignored"
      ? rawEntry.status
      : "learning";
    const exposures = Number.isFinite(rawEntry.exposures)
      ? Math.max(0, Math.round(rawEntry.exposures))
      : 0;
    const successes = Number.isFinite(rawEntry.successes)
      ? Math.max(0, Math.round(rawEntry.successes))
      : 0;
    const lastSeenAt = Number.isFinite(rawEntry.lastSeenAt) ? rawEntry.lastSeenAt : undefined;
    const nextReviewAt = Number.isFinite(rawEntry.nextReviewAt) ? rawEntry.nextReviewAt : undefined;

    output[key] = {
      status,
      familiarity: clamp01(rawEntry.familiarity),
      exposures,
      successes,
      ...(lastSeenAt ? { lastSeenAt } : {}),
      ...(nextReviewAt ? { nextReviewAt } : {}),
    };
  }
  return output;
}

export function looksLikeSpecialTerm(surface: string, lemma: string, rank: number | null): boolean {
  if (!surface || !lemma || rank !== null) {
    return false;
  }

  const trimmed = surface.trim();

  // Built-in learning phrases are intentional learner targets, not identifiers.
  if (/\s/.test(trimmed)) {
    return false;
  }

  // Strong identifier signals only. Capitalization or word length alone are not
  // enough evidence: sentence-initial advanced words must remain learnable.
  if (/[A-Z].*[A-Z]/.test(trimmed)) {
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

export function looksLikeContextualSpecialTerm(surface: string, contextText: string): boolean {
  const trimmedSurface = surface.trim();
  const compactContext = contextText.replace(/\s+/g, " ").trim();

  if (!trimmedSurface || !compactContext || /\s/.test(trimmedSurface)) {
    return false;
  }

  const escapedSurface = escapeRegExp(trimmedSurface);

  if (
    new RegExp(`\\bby\\s+${escapedSurface}\\b`, "i").test(compactContext) ||
    new RegExp(
      `\\b${escapedSurface}\\b\\s+\\d+\\s+(?:minute|minutes|hour|hours|day|days|month|months|year|years)\\s+ago\\b`,
      "i",
    ).test(compactContext) ||
    new RegExp(`\\b${escapedSurface}\\b\\s*\\|\\s*(?:hide|past|favorite|parent|root|next|prev|comments?)\\b`, "i")
      .test(compactContext)
  ) {
    return true;
  }

  if (!/^[A-Z][a-z]{2,}$/.test(trimmedSurface)) {
    return false;
  }

  return (
    new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir)\\.?\\s+${escapedSurface}\\b`).test(compactContext) ||
    new RegExp(`\\b[A-Z][a-z]{2,}\\s+${escapedSurface}\\b`).test(compactContext) ||
    new RegExp(`\\b${escapedSurface}\\s+[A-Z][a-z]{2,}\\b`).test(compactContext)
  );
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
  const wordReviewTrigger = input?.wordReviewTrigger === "selection" ? "selection" : "doubleClick";
  const masteredOverrides = uniqueNormalizedWords(input?.masteredOverrides ?? []).filter(
    (word) => !ignoredSet.has(word),
  );
  const unmasteredOverrides = uniqueNormalizedWords(input?.unmasteredOverrides ?? []).filter(
    (word) => !ignoredSet.has(word),
  );
  const learningProgress = sanitizeLearningProgress(input?.learningProgress);

  // Backfill progress for data created before the familiarity model existed.
  for (const word of masteredOverrides) {
    learningProgress[word] ??= {
      status: "known",
      familiarity: 1,
      exposures: 0,
      successes: 1,
    };
  }
  for (const word of unmasteredOverrides) {
    learningProgress[word] ??= {
      status: "learning",
      familiarity: 0.25,
      exposures: 0,
      successes: 0,
    };
  }
  for (const word of ignoredWords) {
    learningProgress[word] = {
      ...(learningProgress[word] ?? { familiarity: 0, exposures: 0, successes: 0 }),
      status: "ignored",
    };
  }

  return {
    schemaVersion: CURRENT_USER_SETTINGS_SCHEMA_VERSION,
    knownBaseRank,
    masteredOverrides,
    unmasteredOverrides,
    ignoredWords,
    wordReviewTrigger,
    learningProgress,
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
    return { isIgnored: false, isKnown: false, shouldTranslate: false, reason: "invalid" };
  }

  const membership = getMembershipIndex(settings);
  if (membership.unmastered.has(masteryKey)) {
    return { isIgnored: false, isKnown: false, shouldTranslate: true, reason: "translate" };
  }
  if (isBuiltinIgnoredWord(masteryKey) || membership.ignored.has(masteryKey)) {
    return { isIgnored: true, isKnown: false, shouldTranslate: false, reason: "ignored" };
  }
  if (membership.mastered.has(masteryKey)) {
    return { isIgnored: false, isKnown: true, shouldTranslate: false, reason: "known" };
  }
  if (looksLikeSpecialTerm(surface, lemma, rank)) {
    return { isIgnored: true, isKnown: false, shouldTranslate: false, reason: "ignored" };
  }

  const isKnown = rank !== null && rank <= settings.knownBaseRank;
  return {
    isIgnored: false,
    isKnown,
    shouldTranslate: !isKnown,
    reason: isKnown ? "known" : "translate",
  };
}

export function getHighlightIntensity(
  settings: UserSettings,
  surface: string,
  articleOccurrences = 1,
): HighlightIntensity {
  const key = resolveMasteryKey(surface);
  const progress = key ? settings.learningProgress[key] : undefined;

  if (progress?.status === "learning") {
    const due = (progress.nextReviewAt ?? 0) <= Date.now();
    if (due || progress.exposures <= 1) {
      return "strong";
    }

    if (progress.exposures >= 6 && progress.familiarity >= 0.75) {
      return articleOccurrences >= 3 ? "weak" : "none";
    }
    if (progress.exposures >= 4 || progress.familiarity >= 0.55) {
      return articleOccurrences >= 3 ? "normal" : "weak";
    }
    return articleOccurrences >= 3 ? "strong" : "normal";
  }

  return articleOccurrences >= 3 ? "strong" : "normal";
}

export function recordLearningExposure(
  settings: UserSettings,
  surface: string,
  now = Date.now(),
): UserSettings {
  const key = resolveMasteryKey(surface);
  if (!key || !getMembershipIndex(settings).unmastered.has(key)) {
    return settings;
  }

  const current = settings.learningProgress[key] ?? {
    status: "learning" as const,
    familiarity: 0.25,
    exposures: 0,
    successes: 0,
  };
  if (current.lastSeenAt && now - current.lastSeenAt < EXPOSURE_WRITE_THROTTLE_MS) {
    return settings;
  }

  const exposures = current.exposures + 1;
  const familiarity = Math.min(0.8, current.familiarity + 0.1);
  const interval = Math.min(
    MAX_REVIEW_INTERVAL_MS,
    12 * 60 * 60 * 1000 * 2 ** Math.min(exposures - 1, 4),
  );

  return sanitizeSettings({
    ...settings,
    learningProgress: {
      ...settings.learningProgress,
      [key]: {
        ...current,
        status: "learning",
        familiarity,
        exposures,
        lastSeenAt: now,
        nextReviewAt: now + interval,
      },
    },
  });
}

export function setWordMastered(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveMasteryKey(lemma);
  if (!normalized) {
    return settings;
  }
  const previous = settings.learningProgress[normalized];

  return sanitizeSettings({
    ...settings,
    masteredOverrides: [...settings.masteredOverrides, normalized],
    unmasteredOverrides: settings.unmasteredOverrides.filter((word) => word !== normalized),
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
    learningProgress: {
      ...settings.learningProgress,
      [normalized]: {
        status: "known",
        familiarity: 1,
        exposures: previous?.exposures ?? 0,
        successes: (previous?.successes ?? 0) + 1,
        lastSeenAt: Date.now(),
      },
    },
  });
}

export function setWordUnmastered(
  settings: UserSettings,
  lemma: string,
  _rank: number | null,
): UserSettings {
  const normalized = resolveMasteryKey(lemma);
  if (!normalized) {
    return settings;
  }
  const previous = settings.learningProgress[normalized];
  const now = Date.now();

  return sanitizeSettings({
    ...settings,
    masteredOverrides: settings.masteredOverrides.filter((word) => word !== normalized),
    unmasteredOverrides: [...settings.unmasteredOverrides, normalized],
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
    learningProgress: {
      ...settings.learningProgress,
      [normalized]: {
        status: "learning",
        familiarity: Math.min(previous?.familiarity ?? 0.25, 0.35),
        exposures: 0,
        successes: previous?.successes ?? 0,
        lastSeenAt: now,
        nextReviewAt: now,
      },
    },
  });
}

export function setWordIgnored(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveMasteryKey(lemma);
  if (!normalized) {
    return settings;
  }
  const previous = settings.learningProgress[normalized];

  return sanitizeSettings({
    ...settings,
    masteredOverrides: settings.masteredOverrides.filter((word) => word !== normalized),
    unmasteredOverrides: settings.unmasteredOverrides.filter((word) => word !== normalized),
    ignoredWords: [...settings.ignoredWords, normalized],
    learningProgress: {
      ...settings.learningProgress,
      [normalized]: {
        status: "ignored",
        familiarity: previous?.familiarity ?? 0,
        exposures: previous?.exposures ?? 0,
        successes: previous?.successes ?? 0,
        ...(previous?.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
      },
    },
  });
}

export function removeWordIgnored(settings: UserSettings, lemma: string): UserSettings {
  const normalized = resolveMasteryKey(lemma);
  if (!normalized) {
    return settings;
  }
  const learningProgress = { ...settings.learningProgress };
  delete learningProgress[normalized];

  return sanitizeSettings({
    ...settings,
    ignoredWords: settings.ignoredWords.filter((word) => word !== normalized),
    learningProgress,
  });
}

export function updateKnownBaseRank(settings: UserSettings, knownBaseRank: number): UserSettings {
  return sanitizeSettings({ ...settings, knownBaseRank });
}

export function updateWordReviewTrigger(
  settings: UserSettings,
  wordReviewTrigger: UserSettings["wordReviewTrigger"],
): UserSettings {
  return sanitizeSettings({ ...settings, wordReviewTrigger });
}

export function clearLearningProgress(settings: UserSettings): UserSettings {
  return sanitizeSettings({
    knownBaseRank: settings.knownBaseRank,
    masteredOverrides: [],
    unmasteredOverrides: [],
    ignoredWords: [],
    wordReviewTrigger: settings.wordReviewTrigger,
    learningProgress: {},
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
  if (knownCount <= 1500) return "A1";
  if (knownCount <= 3000) return "A2";
  if (knownCount <= 5000) return "B1";
  if (knownCount <= 8000) return "B2";
  return "C1";
}
