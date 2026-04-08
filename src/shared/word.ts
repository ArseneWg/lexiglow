export interface WordAtOffset {
  surface: string;
  start: number;
  end: number;
}

const ENGLISH_WORD_RE = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;

function isWordCharacter(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z']/u.test(char));
}

function isAlphaNumeric(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9]/u.test(char));
}

function isEnglishLikeWord(surface: string): boolean {
  return ENGLISH_WORD_RE.test(surface);
}

function isTechnicalBoundaryCharacter(char: string | undefined): boolean {
  return Boolean(char && /[_@./\\-]/u.test(char));
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
    isTechnicalBoundaryCharacter(text[start - 1]) ||
    isTechnicalBoundaryCharacter(text[end]) ||
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
  return ENGLISH_WORD_RE.test(surface.trim());
}

export function countEnglishWords(text: string): number {
  return normalizeSelectionText(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
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

  let cursor = Math.min(Math.max(offset, 0), text.length - 1);

  if (!isWordCharacter(text[cursor])) {
    if (cursor > 0 && isWordCharacter(text[cursor - 1])) {
      cursor -= 1;
    } else if (cursor + 1 < text.length && isWordCharacter(text[cursor + 1])) {
      cursor += 1;
    } else {
      return null;
    }
  }

  let start = cursor;
  let end = cursor + 1;

  while (start > 0 && isWordCharacter(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && isWordCharacter(text[end])) {
    end += 1;
  }

  if (isEmbeddedInTechnicalToken(text, start, end)) {
    return null;
  }

  const surface = text.slice(start, end);

  if (!isEnglishLikeWord(surface)) {
    return null;
  }

  return { surface, start, end };
}
