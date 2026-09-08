export interface LearningPhrase {
  text: string;
  priority: 1 | 2 | 3;
}

// High-value multi-word expressions for general, academic, and technical reading.
// Keep this list intentionally curated: automatic phrase highlighting should add
// learning value without turning ordinary prose into visual noise.
export const LEARNING_PHRASES: readonly LearningPhrase[] = [
  { text: "account for", priority: 3 },
  { text: "as opposed to", priority: 3 },
  { text: "be subject to", priority: 3 },
  { text: "by means of", priority: 3 },
  { text: "carry out", priority: 3 },
  { text: "come up with", priority: 3 },
  { text: "figure out", priority: 3 },
  { text: "give rise to", priority: 3 },
  { text: "in accordance with", priority: 3 },
  { text: "in addition to", priority: 2 },
  { text: "in contrast to", priority: 3 },
  { text: "in terms of", priority: 3 },
  { text: "in the context of", priority: 3 },
  { text: "in the event of", priority: 3 },
  { text: "in the light of", priority: 3 },
  { text: "lead to", priority: 2 },
  { text: "make sense of", priority: 3 },
  { text: "on behalf of", priority: 3 },
  { text: "point out", priority: 2 },
  { text: "result from", priority: 2 },
  { text: "result in", priority: 2 },
  { text: "rule out", priority: 3 },
  { text: "set out", priority: 3 },
  { text: "take into account", priority: 3 },
  { text: "take place", priority: 2 },
  { text: "with respect to", priority: 3 },
  { text: "with regard to", priority: 3 },
  { text: "depend on", priority: 2 },
  { text: "refer to", priority: 2 },
  { text: "consist of", priority: 2 },
  { text: "contribute to", priority: 3 },
  { text: "deal with", priority: 2 },
  { text: "focus on", priority: 2 },
  { text: "apply to", priority: 2 },
  { text: "based on", priority: 2 },
  { text: "due to", priority: 2 },
  { text: "rather than", priority: 2 },
  { text: "provided that", priority: 3 },
  { text: "as long as", priority: 2 },
  { text: "even though", priority: 2 },
] as const;

const SORTED_PHRASES = [...LEARNING_PHRASES].sort(
  (left, right) => right.text.length - left.text.length,
);

export interface PhraseMatch extends LearningPhrase {
  surface: string;
  start: number;
  end: number;
}

export function normalizePhraseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

function isBoundaryCharacter(value: string | undefined): boolean {
  return !value || !/[A-Za-z0-9']/u.test(value);
}

export function findLearningPhraseMatches(text: string): PhraseMatch[] {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  const matches: PhraseMatch[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  for (const phrase of SORTED_PHRASES) {
    let cursor = 0;

    while (cursor < normalized.length) {
      const start = normalized.indexOf(phrase.text, cursor);
      if (start < 0) {
        break;
      }

      const end = start + phrase.text.length;
      cursor = Math.max(end, start + 1);

      if (!isBoundaryCharacter(normalized[start - 1]) || !isBoundaryCharacter(normalized[end])) {
        continue;
      }

      if (occupied.some((range) => start < range.end && end > range.start)) {
        continue;
      }

      matches.push({
        ...phrase,
        surface: text.slice(start, end),
        start,
        end,
      });
      occupied.push({ start, end });
    }
  }

  return matches.sort((left, right) => left.start - right.start);
}

export function findLearningPhraseAtOffset(text: string, offset: number): PhraseMatch | null {
  return findLearningPhraseMatches(text).find(
    (match) => offset >= match.start && offset <= match.end,
  ) ?? null;
}
