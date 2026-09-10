import { WORDS } from "../generated/lexicon";
import { getLemmaCandidates } from "./normalize";
import { normalizePhraseKey } from "./phrases";
import { getHyphenatedCompoundComponents } from "./word";

const RANK_MAP = new Map<string, number>();

for (const [index, word] of WORDS.entries()) {
  if (!RANK_MAP.has(word)) {
    RANK_MAP.set(word, index + 1);
  }
}

export const LEXICON_WORDS = [...WORDS];

// Only forms that are safe enough to share long-term learning state without
// sentence context belong here. Ambiguous lexical forms such as saw, left,
// found, felt, rose and bit intentionally remain independent surface keys.
const SAFE_IRREGULAR_MASTERY: Readonly<Record<string, string>> = {
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be",
  has: "have", had: "have", does: "do", did: "do", done: "do",
  went: "go", gone: "go", came: "come", became: "become", made: "make",
  took: "take", taken: "take", gave: "give", given: "give", got: "get", gotten: "get",
  seen: "see", knew: "know", known: "know", thought: "think", brought: "bring",
  bought: "buy", caught: "catch", taught: "teach", kept: "keep", held: "hold",
  heard: "hear", met: "meet", paid: "pay", said: "say", told: "tell", sold: "sell",
  sent: "send", spent: "spend", built: "build", lost: "lose", won: "win", sat: "sit",
  stood: "stand", understood: "understand", wrote: "write", written: "write",
  spoke: "speak", spoken: "speak", drove: "drive", driven: "drive", rode: "ride",
  ridden: "ride", risen: "rise", ran: "run", swam: "swim", swum: "swim",
  drank: "drink", drunk: "drink", ate: "eat", eaten: "eat", fell: "fall",
  fallen: "fall", grew: "grow", grown: "grow", flew: "fly", flown: "fly",
  drew: "draw", drawn: "draw", threw: "throw", thrown: "throw", chose: "choose",
  chosen: "choose", broke: "break", broken: "break", forgot: "forget",
  forgotten: "forget", wore: "wear", worn: "wear", tore: "tear", torn: "tear",
  hid: "hide", hidden: "hide", bitten: "bite", blew: "blow", blown: "blow",
  shook: "shake", shaken: "shake", sang: "sing", sung: "sing", rang: "ring",
  rung: "ring", began: "begin", begun: "begin", slept: "sleep", dealt: "deal",
  meant: "mean", led: "lead", laid: "lay", lent: "lend",
  children: "child", men: "man", women: "woman", people: "person", mice: "mouse",
  geese: "goose", feet: "foot", teeth: "tooth", criteria: "criterion",
  phenomena: "phenomenon", indices: "index", matrices: "matrix", vertices: "vertex",
  theses: "thesis",
  better: "good", best: "good", worse: "bad", worst: "bad",
  farther: "far", farthest: "far", further: "far", furthest: "far",
};

// These bases are explicit high-confidence overrides for common regular verbs.
// The resolver below still handles regular morphology generically from spelling
// candidates and frequency evidence, so vocabulary outside this list can share
// mastery when the evidence is strong enough.
const SAFE_REGULAR_BASES = [
  "accept", "achieve", "add", "allow", "analyze", "apply", "ask", "call", "change",
  "check", "close", "compare", "consider", "continue", "create", "decide", "describe",
  "develop", "discover", "explain", "expect", "fetch", "focus", "follow", "help",
  "highlight", "ignore", "improve", "include", "increase", "involve", "learn", "load",
  "look", "mark", "move", "need", "offer", "open", "play", "produce", "provide",
  "read", "receive", "reduce", "remember", "require", "review", "save", "select",
  "show", "start", "stop", "support", "talk", "test", "translate", "turn", "update",
  "use", "walk", "want", "watch", "work",
] as const;

const SAFE_DEGREE_BASES = [
  "big", "small", "large", "high", "low", "long", "short", "fast", "slow", "easy",
  "hard", "early", "late", "young", "old", "new", "close", "strong", "weak", "hot",
  "cold", "warm", "cool", "rich", "poor", "simple", "happy", "busy", "heavy", "light",
  "deep", "wide", "near", "quick", "quiet", "cheap", "clean", "clear", "bright", "dark",
  "tall", "thin", "thick", "smart", "kind", "nice", "safe",
] as const;

const LEXICALIZED_FORM_EXCEPTIONS = new Set([
  "news", "morning", "evening", "ceiling", "during", "king", "thing", "spring",
  "means", "clothes", "customs", "series", "species", "physics", "economics",
  "politics", "mathematics", "headquarters",
]);

function regularForms(base: string): string[] {
  const forms = new Set<string>();
  forms.add(`${base}s`);

  if (base.endsWith("e")) {
    forms.add(`${base}d`);
    forms.add(`${base.slice(0, -1)}ing`);
  } else {
    forms.add(`${base}ed`);
    forms.add(`${base}ing`);
  }

  if (/[^aeiou]y$/i.test(base)) {
    forms.add(`${base.slice(0, -1)}ies`);
    forms.add(`${base.slice(0, -1)}ied`);
  }

  const last = base.at(-1);
  const before = base.at(-2);
  const beforeBefore = base.at(-3);
  if (
    last && before && beforeBefore &&
    !/[aeiouwxy]/.test(last) && /[aeiou]/.test(before) && !/[aeiou]/.test(beforeBefore)
  ) {
    forms.add(`${base}${last}ed`);
    forms.add(`${base}${last}ing`);
  }

  return [...forms];
}

function degreeForms(base: string): string[] {
  if (/[^aeiou]y$/i.test(base)) {
    return [`${base.slice(0, -1)}ier`, `${base.slice(0, -1)}iest`];
  }
  if (base.endsWith("e")) {
    return [`${base}r`, `${base}st`];
  }

  const last = base.at(-1);
  const before = base.at(-2);
  const beforeBefore = base.at(-3);
  if (
    last && before && beforeBefore &&
    !/[aeiouwxy]/.test(last) && /[aeiou]/.test(before) && !/[aeiou]/.test(beforeBefore)
  ) {
    return [`${base}${last}er`, `${base}${last}est`];
  }
  return [`${base}er`, `${base}est`];
}

const SAFE_REGULAR_MASTERY = new Map<string, string>();
for (const base of SAFE_REGULAR_BASES) {
  for (const form of regularForms(base)) {
    SAFE_REGULAR_MASTERY.set(form, base);
  }
}
for (const base of SAFE_DEGREE_BASES) {
  for (const form of degreeForms(base)) {
    SAFE_REGULAR_MASTERY.set(form, base);
  }
}

export function lookupRank(lemma: string): number | null {
  return RANK_MAP.get(lemma) ?? null;
}

function rankedCandidates(candidates: string[]): Array<{ word: string; rank: number }> {
  const seen = new Set<string>();
  const output: Array<{ word: string; rank: number }> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const rank = RANK_MAP.get(candidate);
    if (rank !== undefined) output.push({ word: candidate, rank });
  }
  return output;
}

function isStronglyMoreFrequentBase(surfaceRank: number | undefined, baseRank: number): boolean {
  return surfaceRank === undefined || baseRank * 2 <= surfaceRank;
}

function resolveConfidentRegularMastery(token: string, candidates: string[]): string | null {
  if (LEXICALIZED_FORM_EXCEPTIONS.has(token)) {
    return null;
  }

  const surfaceRank = RANK_MAP.get(token);
  const variants = rankedCandidates(candidates.slice(1));
  if (!variants.length) {
    return null;
  }

  // -ves is genuinely ambiguous for forms such as lives/leaves. Merge only
  // when the lexicon leaves one plausible base (knives->knife, wives->wife).
  if (token.endsWith("ves")) {
    return variants.length === 1 ? variants[0].word : null;
  }

  // Plural / third-person forms are usually safe when one spelling-derived
  // lexical base wins. Prefer direct -s removal before -es alternatives.
  if (token.endsWith("s") && !token.endsWith("ss")) {
    const direct = token.slice(0, -1);
    const directRank = RANK_MAP.get(direct);
    if (directRank !== undefined) {
      return direct;
    }
    if (variants.length === 1) {
      return variants[0].word;
    }
    return null;
  }

  // Past/progressive spelling can also describe lexicalized adjectives/nouns.
  // If the surface itself is a lexical entry, require the base to be at least
  // twice as frequent; otherwise a unique ranked candidate is sufficient.
  if (token.endsWith("ed") || token.endsWith("ing")) {
    const eligible = variants
      .filter(({ rank }) => isStronglyMoreFrequentBase(surfaceRank, rank))
      .sort((left, right) => left.rank - right.rank);
    if (!eligible.length) return null;
    if (eligible.length === 1) return eligible[0].word;
    return eligible[0].rank * 2 <= eligible[1].rank ? eligible[0].word : null;
  }

  // -ies/-ied spelling has a much stronger y-restoration signal.
  if (token.endsWith("ies") || token.endsWith("ied")) {
    const expected = `${token.slice(0, -3)}y`;
    return RANK_MAP.has(expected) ? expected : null;
  }

  return null;
}

export function resolveLookupLemma(surface: string): string {
  if (/\s/.test(surface.trim())) {
    return normalizePhraseKey(surface);
  }

  const candidates = getLemmaCandidates(surface);
  if (!candidates.length) {
    return "";
  }

  return candidates.find((candidate) => RANK_MAP.has(candidate)) ?? candidates[0];
}

export type MasteryResolutionReason =
  | "phrase"
  | "safe-irregular"
  | "safe-regular"
  | "confident-regular"
  | "unique-lemma"
  | "surface";

interface MasteryResolution {
  key: string;
  reason: MasteryResolutionReason;
}

function resolveMastery(surface: string): MasteryResolution {
  if (/\s/.test(surface.trim())) {
    return { key: normalizePhraseKey(surface), reason: "phrase" };
  }

  const candidates = getLemmaCandidates(surface);
  if (!candidates.length) {
    return { key: "", reason: "surface" };
  }

  const token = candidates[0];
  const safeIrregular = SAFE_IRREGULAR_MASTERY[token];
  if (safeIrregular) {
    return { key: safeIrregular, reason: "safe-irregular" };
  }

  const safeRegular = SAFE_REGULAR_MASTERY.get(token);
  if (safeRegular) {
    return { key: safeRegular, reason: "safe-regular" };
  }

  const confidentRegular = resolveConfidentRegularMastery(token, candidates);
  if (confidentRegular) {
    return { key: confidentRegular, reason: "confident-regular" };
  }

  // If the surface is absent from the frequency lexicon, a single lexical
  // candidate is safer than inventing a separate misspelled/inflected key.
  if (!RANK_MAP.has(token)) {
    const variants = rankedCandidates(candidates.slice(1));
    if (variants.length === 1) {
      return { key: variants[0].word, reason: "unique-lemma" };
    }
  }

  return { key: token, reason: "surface" };
}

export function resolveMasteryKey(surface: string): string {
  return resolveMastery(surface).key;
}

export type MasteryIdentityKind =
  | "canonical"
  | "shared-inflection"
  | "independent-inflection"
  | "compound";

export interface MasteryIdentity {
  masteryKey: string;
  kind: MasteryIdentityKind;
  reason: MasteryResolutionReason;
  lexicalLemma?: string;
  components?: string[];
}

export function resolveMasteryIdentity(surface: string, lexicalLemma?: string): MasteryIdentity {
  const resolution = resolveMastery(surface);
  const candidates = getLemmaCandidates(surface);
  const token = candidates[0] || surface.trim().toLowerCase();
  const normalizedLexicalLemma = lexicalLemma?.trim().toLowerCase() || undefined;
  const components = getHyphenatedCompoundComponents(surface)
    .map((component) => resolveLookupLemma(component) || component.toLowerCase());

  if (components.length >= 2) {
    return {
      masteryKey: resolution.key,
      kind: "compound",
      reason: resolution.reason,
      lexicalLemma: normalizedLexicalLemma,
      components,
    };
  }

  if (resolution.key && resolution.key !== token) {
    return {
      masteryKey: resolution.key,
      kind: "shared-inflection",
      reason: resolution.reason,
      lexicalLemma: normalizedLexicalLemma,
    };
  }

  if (normalizedLexicalLemma && normalizedLexicalLemma !== token) {
    return {
      masteryKey: resolution.key,
      kind: "independent-inflection",
      reason: resolution.reason,
      lexicalLemma: normalizedLexicalLemma,
    };
  }

  return {
    masteryKey: resolution.key,
    kind: "canonical",
    reason: resolution.reason,
    lexicalLemma: normalizedLexicalLemma,
  };
}
