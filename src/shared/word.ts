export interface WordAtOffset {
  surface: string;
  start: number;
  end: number;
}

const ENGLISH_TOKEN_SOURCE = "[A-Za-z]+(?:'[A-Za-z]+)?";
const ENGLISH_WORD_RE = new RegExp(`^${ENGLISH_TOKEN_SOURCE}$`);

export function createEnglishTokenMatcher(): RegExp {
  return new RegExp(ENGLISH_TOKEN_SOURCE, "g");
}

export function normalizeSingleEnglishWord(surface: string): string {
  const compact = surface.trim().replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, "");
  return ENGLISH_WORD_RE.test(compact) ? compact : "";
}

function isAlphaNumeric(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9]/u.test(char));
}

function isEnglishLikeWord(surface: string): boolean {
  return ENGLISH_WORD_RE.test(surface);
}

function isStructuralTechnicalBoundaryCharacter(char: string | undefined): boolean {
  return Boolean(char && /[_@/\\]/u.test(char));
}

function isHyphenLinkedToTechnicalToken(text: string, start: number, end: number): boolean {
  if (text[end] === "-") {
    const trailing = text.slice(end + 1, Math.min(text.length, end + 24));
    if (/^[A-Za-z'-]*[@_\\/]/u.test(trailing)) {
      return true;
    }
  }

  if (text[start - 1] === "-") {
    const leading = text.slice(Math.max(0, start - 24), start - 1);
    if (/[@_\\/][A-Za-z'-]*$/u.test(leading)) {
      return true;
    }
  }

  return false;
}

function isDotEmbeddedInTechnicalToken(text: string, start: number, end: number): boolean {
  return (
    text[start - 1] === "." ||
    (text[end] === "." && isAlphaNumeric(text[end + 1]))
  );
}

function isUrlSchemeBoundary(text: string, start: number, end: number): boolean {
  return (
    (text[end] === ":" && text[end + 1] === "/") ||
    (text[start - 1] === "/" && text[start - 2] === ":")
  );
}

function isEmbeddedInTechnicalToken(text: string, start: number, end: number): boolean {
  return (
    isAlphaNumeric(text[start - 1]) ||
    isAlphaNumeric(text[end]) ||
    isStructuralTechnicalBoundaryCharacter(text[start - 1]) ||
    isStructuralTechnicalBoundaryCharacter(text[end]) ||
    isHyphenLinkedToTechnicalToken(text, start, end) ||
    isDotEmbeddedInTechnicalToken(text, start, end) ||
    isUrlSchemeBoundary(text, start, end)
  );
}

function isLikelyTechnicalToken(text: string): boolean {
  const compact = normalizeSelectionText(text);

  if (!compact || /\s/.test(compact)) {
    return false;
  }

  return (
    /^(https?:\/\/|www\.)/i.test(compact) ||
    compact.startsWith(".") ||
    /[@_\\/]/.test(compact) ||
    /[A-Za-z]+\d|\d+[A-Za-z]/.test(compact) ||
    compact.includes(".")
  );
}

export function normalizeSelectionText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isSingleEnglishWord(surface: string): boolean {
  return Boolean(normalizeSingleEnglishWord(surface));
}

export function countEnglishWords(text: string): number {
  const matcher = createEnglishTokenMatcher();
  return normalizeSelectionText(text).match(matcher)?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLineBounds(text: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);

  return {
    lineStart,
    lineEnd: nextBreak >= 0 ? nextBreak : text.length,
  };
}

export function isAuthorBylineWord(
  text: string,
  surface: string,
  start: number,
  end: number,
): boolean {
  const normalizedSurface = normalizeSelectionText(surface).toLowerCase();

  if (!normalizedSurface || normalizedSurface.length > 40) {
    return false;
  }

  const bounds = getLineBounds(text, start, end);
  const line = text.slice(bounds.lineStart, bounds.lineEnd).trim();

  if (!line) {
    return false;
  }

  const compactLine = line.toLowerCase();
  const escapedSurface = escapeRegExp(normalizedSurface);
  const bylinePattern = new RegExp(`\\bby\\s+${escapedSurface}\\b`);

  if (!bylinePattern.test(compactLine)) {
    return false;
  }

  return /\b(points?|comments?|hours?|minutes?|days?)\b/.test(compactLine) || /\bago\b/.test(compactLine) || /\|\s*hide\b/.test(compactLine);
}

export function isEnglishSelectionText(text: string): boolean {
  const compact = normalizeSelectionText(text);

  if (!compact || compact.length > 360 || /[\u4e00-\u9fff]/u.test(compact)) {
    return false;
  }

  if (/[@#][A-Za-z0-9_]/.test(compact)) {
    return false;
  }

  if (!/[A-Za-z]+(?:'[A-Za-z]+)?/.test(compact)) {
    return false;
  }

  if (isLikelyTechnicalToken(compact)) {
    return false;
  }

  return true;
}

export function extractWordAtOffset(text: string, offset: number): WordAtOffset | null {
  if (!text) {
    return null;
  }

  const cursor = Math.min(Math.max(offset, 0), text.length - 1);
  const candidateOffsets = [cursor, cursor - 1, cursor + 1].filter(
    (value) => value >= 0 && value < text.length,
  );
  const matcher = createEnglishTokenMatcher();
  let match = matcher.exec(text);

  while (match) {
    const surface = match[0];
    const start = match.index;
    const end = start + surface.length;

    if (!candidateOffsets.some((value) => value >= start && value < end)) {
      match = matcher.exec(text);
      continue;
    }

    if (isEmbeddedInTechnicalToken(text, start, end)) {
      return null;
    }

    if (!isEnglishLikeWord(surface)) {
      return null;
    }

    return { surface, start, end };
  }

  return null;
}
