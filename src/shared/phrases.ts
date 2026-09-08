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

const PHRASE_HEAD_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  account: ["account", "accounts", "accounted", "accounting"],
  be: ["be", "am", "is", "are", "was", "were", "been", "being"],
  carry: ["carry", "carries", "carried", "carrying"],
  come: ["come", "comes", "came", "coming"],
  figure: ["figure", "figures", "figured", "figuring"],
  give: ["give", "gives", "gave", "given", "giving"],
  lead: ["lead", "leads", "led", "leading"],
  make: ["make", "makes", "made", "making"],
  point: ["point", "points", "pointed", "pointing"],
  result: ["result", "results", "resulted", "resulting"],
  rule: ["rule", "rules", "ruled", "ruling"],
  set: ["set", "sets", "setting"],
  take: ["take", "takes", "took", "taken", "taking"],
  depend: ["depend", "depends", "depended", "depending"],
  refer: ["refer", "refers", "referred", "referring"],
  consist: ["consist", "consists", "consisted", "consisting"],
  contribute: ["contribute", "contributes", "contributed", "contributing"],
  deal: ["deal", "deals", "dealt", "dealing"],
  focus: ["focus", "focuses", "focused", "focusing"],
  apply: ["apply", "applies", "applied", "applying"],
};

interface MatchablePhrase extends LearningPhrase {
  matchText: string;
}

function expandPhrase(phrase: LearningPhrase): MatchablePhrase[] {
  const [head, ...tail] = phrase.text.split(" ");
  const variants = PHRASE_HEAD_VARIANTS[head];
  if (!variants) {
    return [{ ...phrase, matchText: phrase.text }];
  }

  const suffix = tail.length ? ` ${tail.join(" ")}` : "";
  return variants.map((variant) => ({
    ...phrase,
    matchText: `${variant}${suffix}`,
  }));
}

const MATCHABLE_PHRASES = LEARNING_PHRASES
  .flatMap(expandPhrase)
  .sort((left, right) => right.matchText.length - left.matchText.length);

const CANONICAL_BY_VARIANT = new Map<string, string>();
for (const phrase of MATCHABLE_PHRASES) {
  CANONICAL_BY_VARIANT.set(phrase.matchText, phrase.text);
}

export interface PhraseMatch extends LearningPhrase {
  surface: string;
  start: number;
  end: number;
}

function compactPhrase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

export function normalizePhraseKey(value: string): string {
  const compact = compactPhrase(value);
  return CANONICAL_BY_VARIANT.get(compact) ?? compact;
}

function isBoundaryCharacter(value: string | undefined): boolean {
  return !value || !/[A-Za-z0-9']/u.test(value);
}

export function findLearningPhraseMatches(text: string): PhraseMatch[] {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  const matches: PhraseMatch[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  for (const phrase of MATCHABLE_PHRASES) {
    let cursor = 0;

    while (cursor < normalized.length) {
      const start = normalized.indexOf(phrase.matchText, cursor);
      if (start < 0) {
        break;
      }

      const end = start + phrase.matchText.length;
      cursor = Math.max(end, start + 1);

      if (!isBoundaryCharacter(normalized[start - 1]) || !isBoundaryCharacter(normalized[end])) {
        continue;
      }

      if (occupied.some((range) => start < range.end && end > range.start)) {
        continue;
      }

      matches.push({
        text: phrase.text,
        priority: phrase.priority,
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
