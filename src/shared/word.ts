export interface WordAtOffset {
  surface: string;
  start: number;
  end: number;
}

function isWordCharacter(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z']/u.test(char));
}

function isAlphaNumeric(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9]/u.test(char));
}

function isEnglishLikeWord(surface: string): boolean {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(surface);
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
