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

  if (isAlphaNumeric(text[start - 1]) || isAlphaNumeric(text[end])) {
    return null;
  }

  if (text[start - 1] === "@") {
    return null;
  }

  const surface = text.slice(start, end);

  if (!isEnglishLikeWord(surface)) {
    return null;
  }

  return { surface, start, end };
}
