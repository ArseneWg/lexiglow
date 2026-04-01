const LEADING_OR_TRAILING_NON_LETTERS = /^[^A-Za-z]+|[^A-Za-z]+$/g;

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

  let token = cleaned;

  if (token.endsWith("'s")) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s'")) {
    token = token.slice(0, -1);
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

  let token = cleaned;

  if (token.endsWith("'s")) {
    token = token.slice(0, -2);
  } else if (token.endsWith("s'")) {
    token = token.slice(0, -1);
  }

  const candidates = [token];

  if (token.endsWith("ies") && token.length > 4) {
    candidates.push(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith("ing") && token.length > 5) {
    const base = collapseDoubleEnding(token.slice(0, -3));
    candidates.push(base);
    candidates.push(`${base}e`);
  }

  if (token.endsWith("ied") && token.length > 4) {
    candidates.push(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith("ed") && token.length > 4) {
    const rawBase = token.slice(0, -2);
    const collapsedBase = collapseDoubleEnding(rawBase);
    candidates.push(collapsedBase);
    candidates.push(`${rawBase}e`);
    candidates.push(`${collapsedBase}e`);
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
