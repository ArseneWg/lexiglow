import { WORDS } from "../generated/lexicon";
import { getLemmaCandidates } from "./normalize";

const RANK_MAP = new Map<string, number>();

for (const [index, word] of WORDS.entries()) {
  if (!RANK_MAP.has(word)) {
    RANK_MAP.set(word, index + 1);
  }
}

export const LEXICON_WORDS = [...WORDS];

export function lookupRank(lemma: string): number | null {
  return RANK_MAP.get(lemma) ?? null;
}

export function resolveLookupLemma(surface: string): string {
  const candidates = getLemmaCandidates(surface);

  if (!candidates.length) {
    return "";
  }

  return candidates.find((candidate) => RANK_MAP.has(candidate)) ?? candidates[0];
}
