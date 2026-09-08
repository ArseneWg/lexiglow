import { WORDS } from "../generated/lexicon";
import { getLemmaCandidates } from "./normalize";
import { normalizePhraseKey } from "./phrases";

const RANK_MAP = new Map<string, number>();

for (const [index, word] of WORDS.entries()) {
  if (!RANK_MAP.has(word)) {
    RANK_MAP.set(word, index + 1);
  }
}

export const LEXICON_WORDS = [...WORDS];

const SAFE_IRREGULAR_MASTERY: Readonly<Record<string, string>> = {
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be",
  has: "have", had: "have", does: "do", did: "do", done: "do",
  went: "go", gone: "go", came: "come", became: "become", made: "make",
  took: "take", taken: "take", gave: "give", given: "give", gotten: "get",
  knew: "know", known: "know", thought: "think", brought: "bring", bought: "buy",
  caught: "catch", taught: "teach", kept: "keep", held: "hold", heard: "hear",
  met: "meet", paid: "pay", said: "say", told: "tell", sold: "sell", sent: "send",
  spent: "spend", built: "build", lost: "lose", won: "win", sat: "sit",
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
};

// Regular morphology is intentionally whitelisted. A missed merge is much less
// damaging than merging independent words such as news->new or morning->morn.
const SAFE_REGULAR_BASES = [
  "add", "allow", "analyze", "apply", "ask", "call", "change", "check", "close",
  "compare", "continue", "create", "develop", "explain", "fetch", "focus", "help",
  "highlight", "ignore", "include", "learn", "load", "look", "mark", "move", "need",
  "open", "play", "provide", "read", "receive", "remember", "review", "save", "select",
  "show", "start", "stop", "test", "translate", "update", "use", "walk", "work",
] as const;

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

  if (/[^aeiou][y]$/i.test(base)) {
    forms.add(`${base.slice(0, -1)}ies`);
    forms.add(`${base.slice(0, -1)}ied`);
  }

  const last = base.at(-1);
  const before = base.at(-2);
  const beforeBefore = base.at(-3);
  if (
    last && before && beforeBefore &&
    !/[aeiou]/.test(last) && /[aeiou]/.test(before) && !/[aeiou]/.test(beforeBefore)
  ) {
    forms.add(`${base}${last}ed`);
    forms.add(`${base}${last}ing`);
  }

  return [...forms];
}

const SAFE_REGULAR_MASTERY = new Map<string, string>();
for (const base of SAFE_REGULAR_BASES) {
  for (const form of regularForms(base)) {
    if (!SAFE_REGULAR_MASTERY.has(form)) {
      SAFE_REGULAR_MASTERY.set(form, base);
    }
  }
}

export function lookupRank(lemma: string): number | null {
  return RANK_MAP.get(lemma) ?? null;
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

export function resolveMasteryKey(surface: string): string {
  if (/\s/.test(surface.trim())) {
    return normalizePhraseKey(surface);
  }

  const candidates = getLemmaCandidates(surface);
  if (!candidates.length) {
    return "";
  }

  const token = candidates[0];
  const safeIrregular = SAFE_IRREGULAR_MASTERY[token];
  if (safeIrregular) {
    return safeIrregular;
  }

  const safeRegular = SAFE_REGULAR_MASTERY.get(token);
  if (safeRegular) {
    return safeRegular;
  }

  // High-confidence spelling changes are safe when the surface itself is not
  // a lexical entry but the candidate is. Otherwise preserve the surface key.
  if (!RANK_MAP.has(token)) {
    const lexicalCandidate = candidates.slice(1).find((candidate) => RANK_MAP.has(candidate));
    if (lexicalCandidate) {
      return lexicalCandidate;
    }
  }

  return token;
}
