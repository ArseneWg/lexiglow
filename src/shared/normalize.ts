const LEADING_OR_TRAILING_NON_LETTERS = /^[^A-Za-z]+|[^A-Za-z]+$/g;

const IRREGULAR_LEMMAS: Readonly<Record<string, string>> = {
  am: "be",
  is: "be",
  are: "be",
  was: "be",
  were: "be",
  been: "be",
  has: "have",
  had: "have",
  does: "do",
  did: "do",
  done: "do",
  went: "go",
  gone: "go",
  came: "come",
  became: "become",
  made: "make",
  took: "take",
  taken: "take",
  gave: "give",
  given: "give",
  got: "get",
  gotten: "get",
  saw: "see",
  seen: "see",
  knew: "know",
  known: "know",
  thought: "think",
  brought: "bring",
  bought: "buy",
  caught: "catch",
  taught: "teach",
  found: "find",
  felt: "feel",
  left: "leave",
  kept: "keep",
  held: "hold",
  heard: "hear",
  met: "meet",
  paid: "pay",
  said: "say",
  told: "tell",
  sold: "sell",
  sent: "send",
  spent: "spend",
  built: "build",
  lost: "lose",
  won: "win",
  sat: "sit",
  stood: "stand",
  understood: "understand",
  wrote: "write",
  written: "write",
  spoke: "speak",
  spoken: "speak",
  drove: "drive",
  driven: "drive",
  rode: "ride",
  ridden: "ride",
  rose: "rise",
  risen: "rise",
  ran: "run",
  swam: "swim",
  swum: "swim",
  drank: "drink",
  drunk: "drink",
  ate: "eat",
  eaten: "eat",
  fell: "fall",
  fallen: "fall",
  grew: "grow",
  grown: "grow",
  flew: "fly",
  flown: "fly",
  drew: "draw",
  drawn: "draw",
  threw: "throw",
  thrown: "throw",
  chose: "choose",
  chosen: "choose",
  broke: "break",
  broken: "break",
  forgot: "forget",
  forgotten: "forget",
  wore: "wear",
  worn: "wear",
  tore: "tear",
  torn: "tear",
  hid: "hide",
  hidden: "hide",
  bit: "bite",
  bitten: "bite",
  blew: "blow",
  blown: "blow",
  shook: "shake",
  shaken: "shake",
  sang: "sing",
  sung: "sing",
  rang: "ring",
  rung: "ring",
  began: "begin",
  begun: "begin",
  slept: "sleep",
  dealt: "deal",
  meant: "mean",
  led: "lead",
  laid: "lay",
  lent: "lend",
};

function collapseDoubleEnding(base: string): string {
  if (base.length < 3) {
    return base;
  }

  const last = base.at(-1);
  const previous = base.at(-2);

  if (last && previous && last === previous) {
    return base.slice(0, -1);
  }

  return base;
}

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.filter(Boolean))];
}

function normalizePossessiveToken(cleaned: string): string {
  let token = cleaned;

  if (token.endsWith("'s")) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s'")) {
    token = token.slice(0, -1);
  }

  return token;
}

function pushStemVariants(candidates: string[], stem: string) {
  if (!stem) {
    return;
  }

  const collapsedStem = collapseDoubleEnding(stem);
  candidates.push(stem);

  if (collapsedStem !== stem) {
    candidates.push(collapsedStem);
  }

  candidates.push(`${stem}e`);

  if (collapsedStem !== stem) {
    candidates.push(`${collapsedStem}e`);
  }
}

export function cleanSurfaceToken(surface: string): string {
  if (/\d/.test(surface)) {
    return "";
  }

  const trimmed = surface.trim().replace(LEADING_OR_TRAILING_NON_LETTERS, "");

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/['’]/g, "'");
}

export function toLemma(surface: string): string {
  const cleaned = cleanSurfaceToken(surface).toLowerCase();

  if (!cleaned) {
    return "";
  }

  const token = normalizePossessiveToken(cleaned);
  const irregularLemma = IRREGULAR_LEMMAS[token];

  if (irregularLemma) {
    return irregularLemma;
  }

  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("ing") && token.length > 5) {
    return collapseDoubleEnding(token.slice(0, -3));
  }

  if (token.endsWith("ied") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("ed") && token.length > 4) {
    return collapseDoubleEnding(token.slice(0, -2));
  }

  if (token.endsWith("ves") && token.length > 4) {
    return `${token.slice(0, -3)}f`;
  }

  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

export function getLemmaCandidates(surface: string): string[] {
  const cleaned = cleanSurfaceToken(surface).toLowerCase();

  if (!cleaned) {
    return [];
  }

  const token = normalizePossessiveToken(cleaned);

  const candidates = [token];
  const irregularLemma = IRREGULAR_LEMMAS[token];
  if (irregularLemma) {
    candidates.push(irregularLemma);
  }

  if (token.endsWith("ies") && token.length > 4) {
    candidates.push(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith("ing") && token.length > 5) {
    pushStemVariants(candidates, token.slice(0, -3));
  }

  if (token.endsWith("ied") && token.length > 4) {
    candidates.push(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith("ed") && token.length > 4) {
    pushStemVariants(candidates, token.slice(0, -2));
  }

  if (token.endsWith("ves") && token.length > 4) {
    const base = token.slice(0, -3);
    candidates.push(`${base}f`);
    candidates.push(`${base}fe`);
  }

  if (token.endsWith("es") && token.length > 4) {
    const base = token.slice(0, -2);
    candidates.push(base);
    candidates.push(`${base}e`);
  }

  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) {
    candidates.push(token.slice(0, -1));
  }

  return uniqueCandidates(candidates);
}
