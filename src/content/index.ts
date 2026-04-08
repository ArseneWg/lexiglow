import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type {
  LookupWordResponse,
  PronunciationLookupResponse,
  PronunciationResponse,
  RuntimeMessage,
  SentenceAnalysisResponse,
  SelectionTranslationResponse,
  SettingsResponse,
  TranslationProviderChoice,
} from "../shared/messages";
import { DEFAULT_SETTINGS, resolveWordFlags } from "../shared/settings";
import { getSettings } from "../shared/storage";
import { isEnglishSelectionText, isSingleEnglishWord, normalizeSelectionText } from "../shared/word";
import type {
  LexiconLookupResult,
  PronunciationAccent,
  PronunciationResult,
  SentenceAnalysisResult,
  UserSettings,
} from "../shared/types";

const HOVER_DELAY_MS = 320;
const HIDE_DELAY_MS = 1200;
const HIGHLIGHT_NAME = "wordwise-pending";
const HIGHLIGHT_SCAN_LIMIT = 1200;

const TOOLTIP_STYLE = `
  :host {
    all: initial;
  }
  .wordwise-card {
    position: fixed;
    min-width: 220px;
    max-width: 360px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(255, 252, 245, 0.96);
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
    color: #172033;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    backdrop-filter: blur(12px);
    pointer-events: auto;
  }
  .wordwise-card[data-mode="analysis"] {
    max-width: 520px;
  }
  .wordwise-word-view[data-visible="false"],
  .wordwise-analysis-view[data-visible="false"] {
    display: none;
  }
  .wordwise-surface {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 4px;
    color: #10213a;
  }
  .wordwise-pronunciation {
    display: none;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin: 8px 0 10px;
  }
  .wordwise-pronunciation[data-visible="true"] {
    display: grid;
  }
  .wordwise-pronunciation-chip {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.05);
    color: #334155;
    font-size: 12px;
    line-height: 1;
  }
  .wordwise-pronunciation-text {
    display: inline-flex;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
    color: #475569;
    white-space: normal;
    flex-wrap: wrap;
  }
  .wordwise-pronunciation-label {
    font-weight: 700;
    color: #64748b;
    flex: 0 0 auto;
  }
  .wordwise-pronunciation-ipa {
    font-weight: 600;
    color: #7c6f45;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.25;
  }
  .wordwise-pronunciation-action {
    border: 0;
    background: transparent;
    color: #ea580c;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    flex: 0 0 auto;
  }
  .wordwise-pronunciation-action:hover {
    color: #c2410c;
  }
  .wordwise-pronunciation-action[data-playing="true"] {
    color: #dc2626;
  }
  .wordwise-pronunciation-action svg {
    width: 14px;
    height: 14px;
    display: block;
  }
  .wordwise-translation {
    margin-bottom: 8px;
    display: none;
  }
  .wordwise-translation[data-visible="true"] {
    display: block;
  }
  .wordwise-primary-translation {
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
    font-weight: 700;
  }
  .wordwise-secondary-translation {
    font-size: 13px;
    line-height: 1.6;
    color: #4b5563;
    margin-top: 6px;
    display: none;
  }
  .wordwise-secondary-translation[data-visible="true"] {
    display: block;
  }
  .wordwise-hint {
    font-size: 13px;
    line-height: 1.5;
    color: #6b7280;
    margin-bottom: 8px;
  }
  .wordwise-hint[data-visible="false"] {
    display: none;
  }
  .wordwise-hint[data-loading="true"]::after,
  .wordwise-analysis-status[data-loading="true"]::after {
    content: " …";
    display: inline-block;
    vertical-align: baseline;
    animation: wordwise-fade 1s ease-in-out infinite;
  }
  .wordwise-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .wordwise-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .wordwise-rank {
    font-size: 12px;
    color: #5f6b7a;
  }
  .wordwise-button {
    border: 0;
    border-radius: 999px;
    background: #14213d;
    color: white;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .wordwise-button:hover {
    background: #20335d;
  }
  .wordwise-button--secondary {
    background: rgba(20, 33, 61, 0.08);
    color: #14213d;
  }
  .wordwise-button--secondary:hover {
    background: rgba(20, 33, 61, 0.14);
  }
  .wordwise-analysis-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .wordwise-analysis-title {
    font-size: 16px;
    font-weight: 700;
    color: #10213a;
    font-family: inherit;
  }
  .wordwise-analysis-status {
    font-size: 13px;
    line-height: 1.6;
    color: #6b7280;
    margin-bottom: 10px;
    font-family: inherit;
  }
  .wordwise-analysis-section {
    margin-bottom: 14px;
  }
  .wordwise-analysis-loading {
    display: none;
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(20, 33, 61, 0.05);
  }
  .wordwise-analysis-loading[data-visible="true"] {
    display: block;
  }
  .wordwise-analysis-loading-title {
    font-size: 13px;
    line-height: 1.6;
    color: #334155;
    font-family: inherit;
    margin-bottom: 8px;
  }
  .wordwise-analysis-loading-steps {
    display: grid;
    gap: 6px;
  }
  .wordwise-analysis-loading-step {
    font-size: 13px;
    line-height: 1.6;
    color: #475569;
    font-family: inherit;
    opacity: 0.72;
    animation: wordwise-fade 1.2s ease-in-out infinite;
  }
  .wordwise-analysis-loading-step:nth-child(2) {
    animation-delay: 0.15s;
  }
  .wordwise-analysis-loading-step:nth-child(3) {
    animation-delay: 0.3s;
  }
  .wordwise-analysis-loading-step:nth-child(4) {
    animation-delay: 0.45s;
  }
  .wordwise-analysis-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #6b7280;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .wordwise-analysis-source,
  .wordwise-analysis-translation,
  .wordwise-analysis-structure {
    font-size: 14px;
    line-height: 1.7;
    color: #1f2937;
    font-family: inherit;
  }
  .wordwise-analysis-steps {
    margin: 0;
    padding-left: 18px;
    color: #1f2937;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
  }
  .wordwise-analysis-steps li {
    margin-bottom: 6px;
    line-height: 1.65;
    font-family: inherit;
    font-size: 14px;
  }
  .wordwise-analysis-legend {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .wordwise-analysis-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .wordwise-mark {
    padding: 1px 4px;
    border-radius: 6px;
    font-weight: 700;
  }
  .wordwise-mark--subject,
  .wordwise-pill--subject {
    background: rgba(59, 130, 246, 0.16);
    color: #1d4ed8;
  }
  .wordwise-mark--predicate,
  .wordwise-pill--predicate {
    background: rgba(249, 115, 22, 0.16);
    color: #c2410c;
  }
  .wordwise-mark--nonfinite,
  .wordwise-pill--nonfinite {
    background: rgba(168, 85, 247, 0.16);
    color: #7c3aed;
  }
  .wordwise-mark--conjunction,
  .wordwise-pill--conjunction {
    background: rgba(16, 185, 129, 0.18);
    color: #047857;
  }
  .wordwise-mark--relative,
  .wordwise-pill--relative {
    background: rgba(236, 72, 153, 0.16);
    color: #be185d;
  }
  .wordwise-mark--preposition,
  .wordwise-pill--preposition {
    background: rgba(245, 158, 11, 0.18);
    color: #b45309;
  }
  @keyframes wordwise-fade {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
`;

const HIGHLIGHT_STYLE = `
  ::highlight(${HIGHLIGHT_NAME}) {
    background: rgba(250, 204, 21, 0.28);
    font-weight: 600;
  }
`;

const SPEAKER_ICON = `
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M7 3.2 4.6 5.2H2.9a.9.9 0 0 0-.9.9v3.8c0 .5.4.9.9.9h1.7L7 12.8a.55.55 0 0 0 .9-.43V3.63A.55.55 0 0 0 7 3.2Z" fill="currentColor"/>
    <path d="M10.3 5.4a3.2 3.2 0 0 1 0 5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M11.9 4a5.1 5.1 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
`;


interface HoverContext {
  surface: string;
  rect: DOMRect;
  requestId: number;
  forceTranslate?: boolean;
  contextText?: string;
}

interface SentenceSelectionContext {
  text: string;
  rect: DOMRect;
  requestId: number;
  contextText?: string;
}

interface SelectedTextContext {
  text: string;
  rect: DOMRect;
  requestId: number;
  contextText: string;
}

interface WordAtOffset {
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

function extractSentenceAroundRange(text: string, start: number, end: number): string {
  const leftBoundary = Math.max(
    text.lastIndexOf(".", start - 1),
    text.lastIndexOf("!", start - 1),
    text.lastIndexOf("?", start - 1),
    text.lastIndexOf("\n", start - 1),
  );
  const rightCandidates = [
    text.indexOf(".", end),
    text.indexOf("!", end),
    text.indexOf("?", end),
    text.indexOf("\n", end),
  ].filter((value) => value >= 0);
  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
  const sentence = text.slice(leftBoundary >= 0 ? leftBoundary + 1 : 0, rightBoundary).trim();

  if (!sentence) {
    return text.slice(Math.max(0, start - 100), Math.min(text.length, end + 100)).trim();
  }

  return sentence;
}

function extractWordAtOffset(text: string, offset: number): WordAtOffset | null {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function normalizeHighlightWord(value: string): string {
  return value.toLowerCase().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
}

function isAnalyzableSelectionText(text: string): boolean {
  const compact = normalizeSelectionText(text);

  if (!compact || compact.length < 32 || compact.length > 360) {
    return false;
  }

  if (/[\u4e00-\u9fff]/u.test(compact)) {
    return false;
  }

  const words = compact.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  return words.length >= 7;
}

const HIGHLIGHT_CATEGORY_META = {
  subject: { label: "主语", className: "wordwise-mark--subject", pillClassName: "wordwise-pill--subject" },
  predicate: { label: "谓语", className: "wordwise-mark--predicate", pillClassName: "wordwise-pill--predicate" },
  nonfinite: { label: "非谓语", className: "wordwise-mark--nonfinite", pillClassName: "wordwise-pill--nonfinite" },
  conjunction: { label: "连词", className: "wordwise-mark--conjunction", pillClassName: "wordwise-pill--conjunction" },
  relative: { label: "关系词", className: "wordwise-mark--relative", pillClassName: "wordwise-pill--relative" },
  preposition: { label: "介词", className: "wordwise-mark--preposition", pillClassName: "wordwise-pill--preposition" },
} as const;

const CONNECTOR_WORDS = new Set([
  "and", "but", "or", "yet", "so", "although", "though", "because", "if", "while",
  "when", "whereas", "unless", "since", "once", "before", "after", "whether",
]);
const RELATIVE_WORDS = new Set([
  "that", "which", "who", "whom", "whose", "where", "when", "why",
]);
const PREPOSITION_WORDS = new Set([
  "in", "on", "at", "for", "with", "by", "to", "from", "of", "about", "over",
  "under", "after", "before", "during", "through", "between", "against", "into",
  "without", "within", "across",
]);
const PREDICATE_HINT_WORDS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am",
  "has", "have", "had", "do", "does", "did",
  "can", "could", "may", "might", "must", "shall", "should", "will", "would",
  "need", "needs", "needed", "show", "shows", "showed", "shown",
  "suggest", "suggests", "suggested", "mean", "means", "meant",
  "indicate", "indicates", "indicated", "argue", "argues", "argued",
  "say", "says", "said", "make", "makes", "made", "find", "finds", "found",
  "become", "becomes", "became", "remain", "remains", "remained",
]);

function looksLikeFinitePredicate(word: string): boolean {
  if (PREDICATE_HINT_WORDS.has(word)) {
    return true;
  }

  if (word.endsWith("ed") || word.endsWith("es")) {
    return true;
  }

  return word.endsWith("s") && word.length > 3 && !word.endsWith("ss");
}

function buildHighlightCategoryMap(
  result: SentenceAnalysisResult,
  sentence?: string,
): Map<string, keyof typeof HIGHLIGHT_CATEGORY_META> {
  const highlightMap = new Map(
    result.highlights.map((item) => [normalizeHighlightWord(item.text), item.category]),
  );

  for (const word of CONNECTOR_WORDS) {
    if (!highlightMap.has(word)) {
      highlightMap.set(word, "conjunction");
    }
  }

  for (const word of RELATIVE_WORDS) {
    if (!highlightMap.has(word)) {
      highlightMap.set(word, "relative");
    }
  }

  for (const word of PREPOSITION_WORDS) {
    if (!highlightMap.has(word)) {
      highlightMap.set(word, "preposition");
    }
  }

  if (sentence) {
    const tokens = sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
    let predicateCount = [...highlightMap.values()].filter((value) => value === "predicate").length;

    for (const token of tokens) {
      const normalized = normalizeHighlightWord(token);

      if (
        !normalized ||
        CONNECTOR_WORDS.has(normalized) ||
        RELATIVE_WORDS.has(normalized) ||
        PREPOSITION_WORDS.has(normalized)
      ) {
        continue;
      }

      if (looksLikeFinitePredicate(normalized)) {
        highlightMap.set(normalized, "predicate");
        predicateCount += 1;
      }

      if (predicateCount >= 2) {
        break;
      }
    }
  }

  return highlightMap;
}

function renderSentenceMarkup(result: SentenceAnalysisResult, sentence: string): string {
  const highlightMap = buildHighlightCategoryMap(result, sentence);
  const tokens = sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+/g) ?? [sentence];

  return tokens
    .map((token) => {
      const normalized = normalizeHighlightWord(token);
      const category = normalized ? highlightMap.get(normalized) : null;

      if (!category) {
        return escapeHtml(token);
      }

      return `<span class="wordwise-mark ${HIGHLIGHT_CATEGORY_META[category].className}">${escapeHtml(token)}</span>`;
    })
    .join("");
}

function renderLegendMarkup(result: SentenceAnalysisResult, sentence: string): string {
  const highlightMap = buildHighlightCategoryMap(result, sentence);
  const tokens = sentence.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  const categories = [
    ...new Set(
      tokens
        .map((token) => highlightMap.get(normalizeHighlightWord(token)))
        .filter((category): category is keyof typeof HIGHLIGHT_CATEGORY_META => Boolean(category)),
    ),
  ];

  if (!categories.length) {
    return "";
  }

  return categories
    .map((category) => {
      const meta = HIGHLIGHT_CATEGORY_META[category];
      return `<span class="wordwise-analysis-pill ${meta.pillClassName}">${meta.label}</span>`;
    })
    .join("");
}

function createTooltipRoot() {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483647";
  host.style.display = "none";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOOLTIP_STYLE;
  const card = document.createElement("div");
  card.className = "wordwise-card";

  const surfaceEl = document.createElement("div");
  surfaceEl.className = "wordwise-surface";

  const pronunciationEl = document.createElement("div");
  pronunciationEl.className = "wordwise-pronunciation";
  pronunciationEl.dataset.visible = "false";

  const translationEl = document.createElement("div");
  translationEl.className = "wordwise-translation";
  translationEl.dataset.visible = "false";

  const hintEl = document.createElement("div");
  hintEl.className = "wordwise-hint";
  hintEl.dataset.visible = "true";
  hintEl.dataset.loading = "false";
  hintEl.textContent = "默认使用 Google 翻译，不满意可切换到 LLM。";

  const actionsEl = document.createElement("div");
  actionsEl.className = "wordwise-actions";

  const llmButton = document.createElement("button");
  llmButton.className = "wordwise-button wordwise-button--secondary";
  llmButton.textContent = "LLM 翻译";

  const britishChip = document.createElement("div");
  britishChip.className = "wordwise-pronunciation-chip";
  const britishText = document.createElement("span");
  britishText.className = "wordwise-pronunciation-text";
  const britishLabel = document.createElement("span");
  britishLabel.className = "wordwise-pronunciation-label";
  britishLabel.textContent = "英音";
  const britishPhoneticEl = document.createElement("span");
  britishPhoneticEl.className = "wordwise-pronunciation-ipa";
  britishPhoneticEl.textContent = "/.../";
  const britishButton = document.createElement("button");
  britishButton.className = "wordwise-pronunciation-action";
  britishButton.type = "button";
  britishButton.setAttribute("aria-label", "播放英式发音");
  britishButton.innerHTML = SPEAKER_ICON;
  britishText.append(britishLabel, britishPhoneticEl);
  britishChip.append(britishText, britishButton);

  const americanChip = document.createElement("div");
  americanChip.className = "wordwise-pronunciation-chip";
  const americanText = document.createElement("span");
  americanText.className = "wordwise-pronunciation-text";
  const americanLabel = document.createElement("span");
  americanLabel.className = "wordwise-pronunciation-label";
  americanLabel.textContent = "美音";
  const americanPhoneticEl = document.createElement("span");
  americanPhoneticEl.className = "wordwise-pronunciation-ipa";
  americanPhoneticEl.textContent = "/.../";
  const americanButton = document.createElement("button");
  americanButton.className = "wordwise-pronunciation-action";
  americanButton.type = "button";
  americanButton.setAttribute("aria-label", "播放美式发音");
  americanButton.innerHTML = SPEAKER_ICON;
  americanText.append(americanLabel, americanPhoneticEl);
  americanChip.append(americanText, americanButton);
  pronunciationEl.append(britishChip, americanChip);

  const selectionAnalysisButton = document.createElement("button");
  selectionAnalysisButton.className = "wordwise-button wordwise-button--secondary";
  selectionAnalysisButton.textContent = "长难句翻译";

  const ignoreButton = document.createElement("button");
  ignoreButton.className = "wordwise-button wordwise-button--secondary";
  ignoreButton.textContent = "永不翻译";

  const metaEl = document.createElement("div");
  metaEl.className = "wordwise-meta";

  const rankEl = document.createElement("span");
  rankEl.className = "wordwise-rank";

  const button = document.createElement("button");
  button.className = "wordwise-button";
  button.textContent = "已掌握";

  const primaryTranslationEl = document.createElement("div");
  primaryTranslationEl.className = "wordwise-primary-translation";

  const secondaryTranslationEl = document.createElement("div");
  secondaryTranslationEl.className = "wordwise-secondary-translation";
  secondaryTranslationEl.dataset.visible = "false";

  const wordView = document.createElement("div");
  wordView.className = "wordwise-word-view";
  wordView.dataset.visible = "true";

  const analysisView = document.createElement("div");
  analysisView.className = "wordwise-analysis-view";
  analysisView.dataset.visible = "false";

  const analysisHeader = document.createElement("div");
  analysisHeader.className = "wordwise-analysis-header";

  const analysisTitleEl = document.createElement("div");
  analysisTitleEl.className = "wordwise-analysis-title";
  analysisTitleEl.textContent = "长难句分析";

  const analysisTriggerButton = document.createElement("button");
  analysisTriggerButton.className = "wordwise-button";
  analysisTriggerButton.textContent = "开始分析";

  const analysisStatusEl = document.createElement("div");
  analysisStatusEl.className = "wordwise-analysis-status";
  analysisStatusEl.dataset.loading = "false";

  const analysisLoadingEl = document.createElement("div");
  analysisLoadingEl.className = "wordwise-analysis-loading";
  analysisLoadingEl.dataset.visible = "false";
  analysisLoadingEl.innerHTML = `
    <div class="wordwise-analysis-loading-title">正在按田静风格拆句，请稍等</div>
    <div class="wordwise-analysis-loading-steps">
      <div class="wordwise-analysis-loading-step">1. 正在切层次，先找连接标志和关系词</div>
      <div class="wordwise-analysis-loading-step">2. 正在抓主干，定位主句主语和谓语</div>
      <div class="wordwise-analysis-loading-step">3. 正在拆枝叶，整理非谓语和修饰成分</div>
      <div class="wordwise-analysis-loading-step">4. 正在顺译，组织自然的中文表达</div>
    </div>
  `;

  const analysisSourceSection = document.createElement("section");
  analysisSourceSection.className = "wordwise-analysis-section";
  const analysisSourceLabel = document.createElement("div");
  analysisSourceLabel.className = "wordwise-analysis-label";
  analysisSourceLabel.textContent = "原句拆解";
  const analysisSourceEl = document.createElement("div");
  analysisSourceEl.className = "wordwise-analysis-source";
  const analysisLegendEl = document.createElement("div");
  analysisLegendEl.className = "wordwise-analysis-legend";
  analysisSourceSection.append(analysisSourceLabel, analysisSourceEl, analysisLegendEl);

  const analysisTranslationSection = document.createElement("section");
  analysisTranslationSection.className = "wordwise-analysis-section";
  const analysisTranslationLabel = document.createElement("div");
  analysisTranslationLabel.className = "wordwise-analysis-label";
  analysisTranslationLabel.textContent = "整句翻译";
  const analysisTranslationEl = document.createElement("div");
  analysisTranslationEl.className = "wordwise-analysis-translation";
  analysisTranslationSection.append(analysisTranslationLabel, analysisTranslationEl);

  const analysisStructureSection = document.createElement("section");
  analysisStructureSection.className = "wordwise-analysis-section";
  const analysisStructureLabel = document.createElement("div");
  analysisStructureLabel.className = "wordwise-analysis-label";
  analysisStructureLabel.textContent = "主干结构";
  const analysisStructureEl = document.createElement("div");
  analysisStructureEl.className = "wordwise-analysis-structure";
  analysisStructureSection.append(analysisStructureLabel, analysisStructureEl);

  const analysisStepsSection = document.createElement("section");
  analysisStepsSection.className = "wordwise-analysis-section";
  const analysisStepsLabel = document.createElement("div");
  analysisStepsLabel.className = "wordwise-analysis-label";
  analysisStepsLabel.textContent = "分析过程";
  const analysisStepsEl = document.createElement("ol");
  analysisStepsEl.className = "wordwise-analysis-steps";
  analysisStepsSection.append(analysisStepsLabel, analysisStepsEl);

  translationEl.append(primaryTranslationEl, secondaryTranslationEl);
  actionsEl.append(llmButton, selectionAnalysisButton, ignoreButton, button);
  metaEl.append(rankEl);
  wordView.append(surfaceEl, pronunciationEl, hintEl, translationEl, actionsEl, metaEl);
  analysisHeader.append(analysisTitleEl, analysisTriggerButton);
  analysisView.append(
    analysisHeader,
    analysisStatusEl,
    analysisLoadingEl,
    analysisSourceSection,
    analysisTranslationSection,
    analysisStructureSection,
    analysisStepsSection,
  );
  card.append(wordView, analysisView);
  shadow.append(style, card);
  document.documentElement.append(host);

  return {
    host,
    card,
    wordView,
    analysisView,
    surfaceEl,
    pronunciationEl,
    britishPhoneticEl,
    americanPhoneticEl,
    hintEl,
    translationEl,
    primaryTranslationEl,
    secondaryTranslationEl,
    rankEl,
    metaEl,
    button,
    llmButton,
    britishButton,
    americanButton,
    selectionAnalysisButton,
    ignoreButton,
    analysisTitleEl,
    analysisTriggerButton,
    analysisStatusEl,
    analysisLoadingEl,
    analysisSourceEl,
    analysisLegendEl,
    analysisTranslationEl,
    analysisStructureEl,
    analysisStepsEl,
  };
}

function installHighlightStyle() {
  const style = document.createElement("style");
  style.dataset.wordwise = "highlight-style";
  style.textContent = HIGHLIGHT_STYLE;
  document.documentElement.append(style);
}

function getCaretRangeFromPoint(x: number, y: number): { node: Text; offset: number } | null {
  if ("caretPositionFromPoint" in document) {
    const caret = document.caretPositionFromPoint(x, y);
    if (caret?.offsetNode?.nodeType === Node.TEXT_NODE) {
      return {
        node: caret.offsetNode as Text,
        offset: caret.offset,
      };
    }
  }

  if ("caretRangeFromPoint" in document) {
    const caret = document.caretRangeFromPoint(x, y);
    if (caret?.startContainer?.nodeType === Node.TEXT_NODE) {
      return {
        node: caret.startContainer as Text,
        offset: caret.startOffset,
      };
    }
  }

  return null;
}

function getSelectedWordContext(): HoverContext | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const surface = selection.toString().trim();

  if (!isSingleEnglishWord(surface)) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();

  if ((!rect.width && !rect.height) || !isFinite(rect.left) || !isFinite(rect.top)) {
    return null;
  }

  let contextText = surface;
  const startContainer = range.startContainer;

  if (startContainer.nodeType === Node.TEXT_NODE && startContainer === range.endContainer) {
    const textNode = startContainer as Text;
    contextText = extractSentenceAroundRange(textNode.textContent ?? "", range.startOffset, range.endOffset);
  }

  activeRequestId += 1;

  return {
    surface,
    rect,
    requestId: activeRequestId,
    forceTranslate: true,
    contextText,
  };
}

function getSelectionContextText(range: Range, fallback: string): string {
  const startContainer = range.startContainer;

  if (startContainer.nodeType === Node.TEXT_NODE && startContainer === range.endContainer) {
    const textNode = startContainer as Text;
    return extractSentenceAroundRange(textNode.textContent ?? "", range.startOffset, range.endOffset);
  }

  return fallback;
}

function getSelectedTextContext(): SelectedTextContext | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const text = normalizeSelectionText(selection.toString());

  if (
    !isEnglishSelectionText(text) ||
    isIgnoredContainer(range.startContainer) ||
    isIgnoredContainer(range.endContainer)
  ) {
    return null;
  }

  const rect = range.getBoundingClientRect();

  if ((!rect.width && !rect.height) || !isFinite(rect.left) || !isFinite(rect.top)) {
    return null;
  }

  selectionRequestId += 1;

  return {
    text,
    rect,
    requestId: selectionRequestId,
    contextText: getSelectionContextText(range, text),
  };
}

function getSelectedSentenceContext(): SentenceSelectionContext | null {
  const context = getSelectedTextContext();

  if (!context || !isAnalyzableSelectionText(context.text)) {
    return null;
  }

  return context;
}

function isIgnoredContainer(node: Node): boolean {
  if (node.getRootNode() === tooltip.host.shadowRoot) {
    return true;
  }

  const element = node.parentElement;

  if (!element) {
    return false;
  }

  if (element.closest("input, textarea, select, option, code, pre, script, style, noscript")) {
    return true;
  }

  if (element.closest("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']")) {
    return true;
  }

  return false;
}

function rankLabel(result: LexiconLookupResult): string {
  if (result.rank === null) {
    return "词表外";
  }

  return `词频 #${result.rank}`;
}

function runtimeSend<T>(message: RuntimeMessage): Promise<T> {
  const runtimeApi = globalThis.chrome?.runtime;

  if (!runtimeApi?.sendMessage) {
    return Promise.reject(new Error("Extension context invalidated."));
  }

  return runtimeApi.sendMessage(message) as Promise<T>;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  if (
    error instanceof TypeError &&
    error.message.toLowerCase().includes("sendmessage")
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("extension context invalidated")
  );
}

function supportsHighlights(): boolean {
  return typeof Highlight !== "undefined" && "highlights" in CSS;
}

function shouldSkipTextNode(node: Text): boolean {
  if (!node.textContent?.trim()) {
    return true;
  }

  return isIgnoredContainer(node);
}

function isVisibleRect(rect: DOMRect): boolean {
  const bleed = 120;

  return !(
    rect.bottom < -bleed ||
    rect.right < -bleed ||
    rect.top > window.innerHeight + bleed ||
    rect.left > window.innerWidth + bleed
  );
}

const tooltip = createTooltipRoot();
installHighlightStyle();

let hoverTimer: number | null = null;
let hideTimer: number | null = null;
let highlightTimer: number | null = null;
let activeRequestId = 0;
let activeResult: LexiconLookupResult | null = null;
let activeAnchorRect: DOMRect | null = null;
let activeContext: HoverContext | null = null;
let currentSettings: UserSettings | null = null;
let tooltipHovered = false;
let lastMouseX = 0;
let lastMouseY = 0;
let activeTranslationRequestId = 0;
let activeSelectionTooltipContext: SelectedTextContext | null = null;
let activeSelectionTranslationRequestId = 0;
let activeSelectionContext: SentenceSelectionContext | null = null;
let selectionRequestId = 0;
let analysisPanelOpen = false;
let activeSentenceAnalysisRequestId = 0;
let suppressSelectionTriggerUntil = 0;
let activeWordTooltipSource: "hover-word" | "review-word" | "selection-translate" = "hover-word";
let activePronunciationSurface = "";
let activePronunciationRequestId = 0;
let activePronunciationResult: PronunciationResult | null = null;
let activePronunciationAudio: HTMLAudioElement | null = null;

function stopActivePronunciationAudio() {
  if (!activePronunciationAudio) {
    return;
  }

  activePronunciationAudio.pause();
  activePronunciationAudio.currentTime = 0;
  activePronunciationAudio = null;
}

function hideTooltip() {
  stopActivePronunciationAudio();
  tooltip.host.style.display = "none";
  tooltip.card.dataset.mode = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  activeResult = null;
  activeAnchorRect = null;
  activeContext = null;
  activeSelectionTooltipContext = null;
  activeTranslationRequestId += 1;
  activeSelectionTranslationRequestId += 1;
  activePronunciationRequestId += 1;
  activePronunciationSurface = "";
  activePronunciationResult = null;
  if (!analysisPanelOpen) {
    activeSelectionContext = null;
  }
}

function cancelActiveAsyncRequests() {
  activeRequestId += 1;
  activeTranslationRequestId += 1;
  activeSelectionTranslationRequestId += 1;
  activeSentenceAnalysisRequestId += 1;
}

function clearHighlights() {
  if (!supportsHighlights()) {
    return;
  }

  CSS.highlights.delete(HIGHLIGHT_NAME);
}

function scheduleHide() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }

  hideTimer = window.setTimeout(() => {
    if (
      tooltipHovered ||
      isPointerNearTooltip(lastMouseX, lastMouseY) ||
      isPointerNearAnchor(lastMouseX, lastMouseY) ||
      isPointerInTooltipCorridor(lastMouseX, lastMouseY)
    ) {
      scheduleHide();
      return;
    }

    hideTooltip();
  }, HIDE_DELAY_MS);
}

async function refreshHighlightsNow() {
  clearHighlights();
  await refreshHighlights();
}

function positionTooltip(rect: DOMRect) {
  const margin = 12;
  const cardRect = tooltip.card.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;

  if (left + cardRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - cardRect.width - margin);
  }

  if (top + cardRect.height > window.innerHeight - margin) {
    top = rect.top - cardRect.height - 4;
  }

  if (top < margin) {
    top = margin;
  }

  tooltip.card.style.left = `${left}px`;
  tooltip.card.style.top = `${top}px`;
}

function hideSentenceAnalysis(options?: { preservePanel?: boolean }) {
  if (!options?.preservePanel) {
    tooltip.hintEl.dataset.loading = "false";
    tooltip.analysisStatusEl.textContent = "";
    tooltip.analysisStatusEl.dataset.loading = "false";
    tooltip.analysisLoadingEl.dataset.visible = "false";
    tooltip.analysisSourceEl.innerHTML = "";
    tooltip.analysisLegendEl.innerHTML = "";
    tooltip.analysisTranslationEl.textContent = "";
    tooltip.analysisStructureEl.textContent = "";
    tooltip.analysisStepsEl.innerHTML = "";
    tooltip.analysisTriggerButton.style.display = "none";
    analysisPanelOpen = false;
    activeSelectionContext = null;
  }

  tooltip.analysisView.dataset.visible = "false";
  tooltip.card.dataset.mode = "word";
}

function positionSentenceAnalysisButton(rect: DOMRect) {
  positionTooltip(rect);
}

function positionSentenceAnalysisPanel(rect: DOMRect) {
  positionTooltip(rect);
}

function setWordTooltipControls(mode: "word" | "selection") {
  const isSelection = mode === "selection";
  tooltip.button.style.display = isSelection ? "none" : "inline-flex";
  tooltip.ignoreButton.style.display = isSelection ? "none" : "inline-flex";
  tooltip.metaEl.style.display = isSelection ? "none" : "flex";
  tooltip.llmButton.style.display = "inline-flex";
  tooltip.pronunciationEl.dataset.visible = isSelection ? "false" : "true";
  tooltip.britishButton.dataset.playing = "false";
  tooltip.americanButton.dataset.playing = "false";
  tooltip.selectionAnalysisButton.style.display = isSelection ? "inline-flex" : "none";
}

function resetPronunciationDisplay(surface: string) {
  activePronunciationSurface = surface;
  activePronunciationResult = null;
  tooltip.britishPhoneticEl.textContent = "/.../";
  tooltip.americanPhoneticEl.textContent = "/.../";
}

async function loadPronunciation(surface: string) {
  activePronunciationRequestId += 1;
  const requestId = activePronunciationRequestId;
  const normalizedSurface = surface.trim();

  if (!normalizedSurface) {
    return;
  }

  let response: PronunciationLookupResponse;

  try {
    response = await runtimeSend<PronunciationLookupResponse>({
      type: "LOOKUP_PRONUNCIATION",
      payload: {
        surface: normalizedSurface,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (
    !response.ok ||
    requestId !== activePronunciationRequestId ||
    activeWordTooltipSource === "selection-translate" ||
    activePronunciationSurface !== normalizedSurface
  ) {
    return;
  }

  activePronunciationResult = response.result ?? null;
  tooltip.britishPhoneticEl.textContent = response.result?.ukPhonetic ?? "/.../";
  tooltip.americanPhoneticEl.textContent = response.result?.usPhonetic ?? "/.../";
}

function renderSelectionTooltip(
  context: SelectedTextContext,
  result?: {
    translation?: string;
    sentenceTranslation?: string;
    translationProvider?: string;
  },
) {
  tooltip.card.dataset.mode = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  setWordTooltipControls("selection");
  tooltip.surfaceEl.textContent = context.text;
  tooltip.primaryTranslationEl.textContent = result?.translation ?? "";
  tooltip.secondaryTranslationEl.textContent = result?.sentenceTranslation ?? "";
  tooltip.secondaryTranslationEl.dataset.visible = result?.sentenceTranslation ? "true" : "false";
  tooltip.translationEl.dataset.visible = result?.translation ? "true" : "false";
  tooltip.hintEl.dataset.visible = "true";
  tooltip.hintEl.dataset.loading = "false";
  tooltip.hintEl.textContent = result?.translationProvider === "deepseek-chat"
    ? "已使用 LLM 翻译。"
    : "默认 Google 结果，不满意可试试 LLM，或点长难句翻译。";
  tooltip.rankEl.textContent = "";
  tooltip.host.style.display = "block";
  activeAnchorRect = context.rect;
  activeSelectionTooltipContext = context;
  activeSelectionContext = context;
  activeWordTooltipSource = "selection-translate";
  activePronunciationRequestId += 1;
  activePronunciationSurface = "";
  activeContext = null;
  activeResult = null;
  analysisPanelOpen = false;
  positionTooltip(context.rect);
}

function showSentenceAnalysisButton(context: SentenceSelectionContext) {
  activeSelectionContext = context;
  activeAnchorRect = context.rect;
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = "长难句分析";
  tooltip.analysisTriggerButton.style.display = "inline-flex";
  tooltip.analysisTriggerButton.textContent = "开始分析";
  tooltip.analysisStatusEl.dataset.loading = "false";
  tooltip.analysisStatusEl.textContent = "按田静常见讲法来拆：先切层次，再抓主干，再拆枝叶，最后顺译。";
  tooltip.analysisLoadingEl.dataset.visible = "false";
  tooltip.analysisSourceEl.textContent = context.text;
  tooltip.analysisLegendEl.innerHTML = "";
  tooltip.analysisTranslationEl.textContent = "";
  tooltip.analysisStructureEl.textContent = "";
  tooltip.analysisStepsEl.innerHTML = "";
  tooltip.host.style.display = "block";
  analysisPanelOpen = false;
  positionSentenceAnalysisButton(context.rect);
}

function isPointerNearTooltip(clientX: number, clientY: number): boolean {
  if (tooltip.host.style.display !== "block") {
    return false;
  }

  const rect = tooltip.card.getBoundingClientRect();
  const padding = 18;

  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function isPointerNearAnchor(clientX: number, clientY: number): boolean {
  if (!activeAnchorRect) {
    return false;
  }

  const padding = 22;

  return (
    clientX >= activeAnchorRect.left - padding &&
    clientX <= activeAnchorRect.right + padding &&
    clientY >= activeAnchorRect.top - padding &&
    clientY <= activeAnchorRect.bottom + padding
  );
}

function isPointerInTooltipCorridor(clientX: number, clientY: number): boolean {
  if (tooltip.host.style.display !== "block" || !activeAnchorRect) {
    return false;
  }

  const tooltipRect = tooltip.card.getBoundingClientRect();
  const padding = 18;
  const left = Math.min(activeAnchorRect.left, tooltipRect.left) - padding;
  const right = Math.max(activeAnchorRect.right, tooltipRect.right) + padding;
  const top = Math.min(activeAnchorRect.top, tooltipRect.top) - padding;
  const bottom = Math.max(activeAnchorRect.bottom, tooltipRect.bottom) + padding;

  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

function renderTooltip(result: LexiconLookupResult, rect: DOMRect) {
  tooltip.card.dataset.mode = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  setWordTooltipControls("word");
  tooltip.surfaceEl.textContent = result.surface;
  tooltip.primaryTranslationEl.textContent = result.translation ?? "";
  tooltip.secondaryTranslationEl.textContent = result.sentenceTranslation ?? "";
  tooltip.secondaryTranslationEl.dataset.visible = result.sentenceTranslation ? "true" : "false";
  tooltip.translationEl.dataset.visible = result.translation ? "true" : "false";
  tooltip.hintEl.dataset.visible = result.translation ? "false" : "true";
  tooltip.hintEl.dataset.loading = "false";
  if (!result.translation) {
    tooltip.hintEl.textContent = "默认使用 Google 翻译，不满意可切换到 LLM。";
    tooltip.secondaryTranslationEl.dataset.visible = "false";
  }
  tooltip.rankEl.textContent = rankLabel(result);
  tooltip.host.style.display = "block";
  activeAnchorRect = rect;
  activeSelectionTooltipContext = null;
  activeWordTooltipSource = activeContext?.forceTranslate ? "review-word" : "hover-word";
  positionTooltip(rect);
  activeResult = result;
  if (activePronunciationSurface !== result.surface) {
    resetPronunciationDisplay(result.surface);
    void loadPronunciation(result.surface);
  }
}

function renderSentenceAnalysisPanel(
  result: SentenceAnalysisResult,
  context: SentenceSelectionContext,
) {
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = "长难句分析";
  tooltip.analysisTriggerButton.style.display = "none";
  tooltip.analysisStatusEl.textContent = "田静风拆法：先找连接标志切层次，再抓主句主干，再拆非谓语和修饰成分，最后顺译。";
  tooltip.analysisStatusEl.dataset.loading = "false";
  tooltip.analysisLoadingEl.dataset.visible = "false";
  tooltip.analysisSourceEl.innerHTML = renderSentenceMarkup(result, context.text);
  tooltip.analysisLegendEl.innerHTML = renderLegendMarkup(result, context.text);
  tooltip.analysisTranslationEl.textContent = result.translation;
  tooltip.analysisStructureEl.textContent = result.structure;
  tooltip.analysisStepsEl.innerHTML = result.analysisSteps
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");
  tooltip.host.style.display = "block";
  analysisPanelOpen = true;
  positionSentenceAnalysisPanel(context.rect);
}

async function ensureSettings(): Promise<UserSettings> {
  if (currentSettings) {
    return currentSettings;
  }

  try {
    currentSettings = await getSettings();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      currentSettings = DEFAULT_SETTINGS;
      hideTooltip();
      clearHighlights();
      return currentSettings;
    }

    throw error;
  }

  return currentSettings;
}

async function refreshHighlights() {
  if (!supportsHighlights() || !document.body) {
    return;
  }

  const settings = await ensureSettings();
  const highlight = new Highlight();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node instanceof Text && !shouldSkipTextNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const matcher = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  let pendingCount = 0;
  let currentNode = walker.nextNode();

  while (currentNode && pendingCount < HIGHLIGHT_SCAN_LIMIT) {
    const textNode = currentNode as Text;
    const text = textNode.textContent ?? "";
    matcher.lastIndex = 0;

    let match = matcher.exec(text);
    while (match && pendingCount < HIGHLIGHT_SCAN_LIMIT) {
      const surface = match[0];
      const start = match.index;
      const end = match.index + surface.length;

      if (isEmbeddedInTechnicalToken(text, start, end)) {
        match = matcher.exec(text);
        continue;
      }

      const lemma = resolveLookupLemma(surface);
      const rank = lemma ? lookupRank(lemma) : null;
      const flags = resolveWordFlags(lemma, rank, settings, surface);

      if (flags.shouldTranslate) {
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        const rect = range.getBoundingClientRect();

        if (isVisibleRect(rect)) {
          highlight.add(range);
          pendingCount += 1;
        }
      }

      match = matcher.exec(text);
    }

    currentNode = walker.nextNode();
  }

  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

function scheduleHighlightRefresh() {
  if (!supportsHighlights()) {
    return;
  }

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  highlightTimer = window.setTimeout(() => {
    void refreshHighlights();
  }, 220);
}

async function resolveHoverWord(context: HoverContext) {
  let response: LookupWordResponse;

  try {
    response = await runtimeSend<LookupWordResponse>({
      type: "LOOKUP_WORD",
      payload: {
        surface: context.surface,
        forceTranslate: context.forceTranslate,
        contextText: context.contextText,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    hideTooltip();
    return;
  }

  if (context.requestId !== activeRequestId) {
    return;
  }

  if (!response.result.shouldTranslate) {
    hideTooltip();
    return;
  }

  activeContext = context;
  renderTooltip(response.result, context.rect);
  await requestTranslationForContext("google", context);
}

async function requestTranslation(provider: TranslationProviderChoice) {
  if (!activeContext) {
    return;
  }

  const requestContext = activeContext;
  activeTranslationRequestId += 1;
  const translationRequestId = activeTranslationRequestId;

  tooltip.translationEl.dataset.visible = "false";
  tooltip.primaryTranslationEl.textContent = "";
  tooltip.secondaryTranslationEl.textContent = "";
  tooltip.secondaryTranslationEl.dataset.visible = "false";
  tooltip.hintEl.dataset.visible = "true";
  tooltip.hintEl.dataset.loading = "true";
  tooltip.hintEl.textContent = provider === "llm" ? "LLM 翻译中..." : "Google 翻译中...";

  let response: LookupWordResponse;

  try {
    response = await runtimeSend<LookupWordResponse>({
      type: "TRANSLATE_WORD",
      payload: {
        surface: requestContext.surface,
        contextText: requestContext.contextText,
        forceTranslate: requestContext.forceTranslate,
        provider,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    if (translationRequestId === activeTranslationRequestId) {
      tooltip.hintEl.dataset.loading = "false";
      tooltip.hintEl.textContent = "翻译暂不可用。";
    }
    return;
  }

  if (
    translationRequestId !== activeTranslationRequestId ||
    !activeContext ||
    activeContext.requestId !== requestContext.requestId
  ) {
    return;
  }

  activeResult = response.result;
  renderTooltip(response.result, requestContext.rect);
  if (response.result.translationProvider) {
    const providerLabel =
      response.result.translationProvider === "google-web" ? "Google" : "LLM";
    tooltip.hintEl.dataset.loading = "false";
    tooltip.hintEl.textContent =
      providerLabel === "Google" ? "默认 Google 结果，不满意可试试 LLM。" : "已使用 LLM 翻译。";
  }
}

async function requestSelectionTranslation(
  provider: TranslationProviderChoice,
  context = activeSelectionTooltipContext,
) {
  if (!context) {
    return;
  }

  activeSelectionTooltipContext = context;
  activeSelectionTranslationRequestId += 1;
  const translationRequestId = activeSelectionTranslationRequestId;

  renderSelectionTooltip(context);
  tooltip.hintEl.dataset.loading = "true";
  tooltip.hintEl.textContent = provider === "llm" ? "LLM 翻译中..." : "Google 翻译中...";

  let response: SelectionTranslationResponse;

  try {
    response = await runtimeSend<SelectionTranslationResponse>({
      type: "TRANSLATE_SELECTION",
      payload: {
        text: context.text,
        contextText: context.contextText,
        provider,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    if (translationRequestId === activeSelectionTranslationRequestId) {
      tooltip.hintEl.dataset.loading = "false";
      tooltip.hintEl.textContent = "翻译暂不可用。";
    }
    return;
  }

  if (
    translationRequestId !== activeSelectionTranslationRequestId ||
    !activeSelectionTooltipContext ||
    activeSelectionTooltipContext.requestId !== context.requestId
  ) {
    return;
  }

  renderSelectionTooltip(context, {
    translation: response.result.translation,
    sentenceTranslation: response.result.sentenceTranslation,
    translationProvider: response.result.translationProvider,
  });
}

async function requestTranslationForContext(
  provider: TranslationProviderChoice,
  context: HoverContext,
) {
  activeContext = context;
  await requestTranslation(provider);
}

function showPronunciationFeedback(button: HTMLButtonElement) {
  button.dataset.playing = "true";
  window.setTimeout(() => {
    button.dataset.playing = "false";
  }, 1200);
}

async function playPronunciationAudio(
  audioUrl: string,
  button: HTMLButtonElement,
): Promise<boolean> {
  try {
    stopActivePronunciationAudio();
    const audio = new Audio(audioUrl);
    activePronunciationAudio = audio;
    audio.preload = "auto";
    button.dataset.playing = "true";

    await audio.play();

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("abort", handleError);
      };
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("audio playback failed"));
      };

      audio.addEventListener("ended", handleEnded, { once: true });
      audio.addEventListener("error", handleError, { once: true });
      audio.addEventListener("abort", handleError, { once: true });
    });

    if (activePronunciationAudio === audio) {
      activePronunciationAudio = null;
    }
    button.dataset.playing = "false";
    return true;
  } catch {
    button.dataset.playing = "false";
    if (activePronunciationAudio) {
      activePronunciationAudio = null;
    }
    return false;
  }
}

async function speakPronunciation(accent: PronunciationAccent) {
  if (!activeResult?.surface || activeWordTooltipSource === "selection-translate") {
    return;
  }

  const button = accent === "en-GB" ? tooltip.britishButton : tooltip.americanButton;
  const audioUrl = accent === "en-GB"
    ? activePronunciationResult?.ukAudioUrl
    : activePronunciationResult?.usAudioUrl;

  let response: PronunciationResponse;

  showPronunciationFeedback(button);

  try {
    response = await runtimeSend<PronunciationResponse>({
      type: "SPEAK_PRONUNCIATION",
      payload: {
        text: activeResult.surface,
        accent,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok) {
    button.dataset.playing = "false";

    if (audioUrl) {
      const played = await playPronunciationAudio(audioUrl, button);

      if (played) {
        return;
      }
    }

    tooltip.hintEl.dataset.visible = "true";
    tooltip.hintEl.dataset.loading = "false";
    tooltip.hintEl.textContent = response.error ?? "发音暂不可用。";
  }
}

async function requestSentenceAnalysis(context: SentenceSelectionContext) {
  activeSentenceAnalysisRequestId += 1;
  const requestId = activeSentenceAnalysisRequestId;
  activeSelectionContext = context;
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = "长难句分析";
  tooltip.analysisTriggerButton.style.display = "none";
  tooltip.analysisStatusEl.dataset.loading = "true";
  tooltip.analysisStatusEl.textContent = "正在分析长难句";
  tooltip.analysisLoadingEl.dataset.visible = "true";
  tooltip.analysisSourceEl.textContent = context.text;
  tooltip.analysisLegendEl.innerHTML = "";
  tooltip.analysisTranslationEl.textContent = "";
  tooltip.analysisStructureEl.textContent = "";
  tooltip.analysisStepsEl.innerHTML = "";
  tooltip.host.style.display = "block";
  analysisPanelOpen = true;
  positionSentenceAnalysisPanel(context.rect);
  await waitForPaint();

  let response: SentenceAnalysisResponse;

  try {
    response = await runtimeSend<SentenceAnalysisResponse>({
      type: "ANALYZE_SELECTION",
      payload: {
        text: context.text,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (requestId !== activeSentenceAnalysisRequestId) {
    return;
  }

  if (!response.ok || !response.result) {
    tooltip.analysisStatusEl.dataset.loading = "false";
    tooltip.analysisLoadingEl.dataset.visible = "false";
    tooltip.analysisStatusEl.textContent = response.error ?? "长难句分析暂不可用。";
    return;
  }

  renderSentenceAnalysisPanel(response.result, context);
}

async function markWordForReview(surface: string): Promise<boolean> {
  const lemma = resolveLookupLemma(surface);
  const rank = lemma ? lookupRank(lemma) : null;
  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_UNMASTERED",
      payload: {
        lemma,
        rank,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return false;
    }

    throw error;
  }

  if (!response.ok) {
    return false;
  }

  currentSettings = response.settings ?? currentSettings;
  await refreshHighlightsNow();
  return true;
}

function scheduleLookup(context: HoverContext) {
  if (hoverTimer) {
    window.clearTimeout(hoverTimer);
  }

  hoverTimer = window.setTimeout(() => {
    void resolveHoverWord(context);
  }, HOVER_DELAY_MS);
}

function isSameHoverTarget(context: HoverContext): boolean {
  if (!activeContext || !activeAnchorRect) {
    return false;
  }

  return (
    activeContext.surface === context.surface &&
    Math.abs(activeAnchorRect.left - context.rect.left) < 1 &&
    Math.abs(activeAnchorRect.top - context.rect.top) < 1 &&
    Math.abs(activeAnchorRect.width - context.rect.width) < 1 &&
    Math.abs(activeAnchorRect.height - context.rect.height) < 1
  );
}

function getHoverContext(clientX: number, clientY: number): HoverContext | null {
  const caret = getCaretRangeFromPoint(clientX, clientY);

  if (!caret || isIgnoredContainer(caret.node)) {
    return null;
  }

  const text = caret.node.textContent ?? "";
  const word = extractWordAtOffset(text, caret.offset);

  if (!word) {
    return null;
  }

  const range = document.createRange();
  range.setStart(caret.node, word.start);
  range.setEnd(caret.node, word.end);

  const rect = range.getBoundingClientRect();

  if (!rect.width && !rect.height) {
    return null;
  }

  activeRequestId += 1;

  return {
    surface: word.surface,
    rect,
    requestId: activeRequestId,
    contextText: extractSentenceAroundRange(text, word.start, word.end),
  };
}

function updateSelectionAnalysisTrigger() {
  if (Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  const context = getSelectedTextContext();

  if (!context) {
    const hadAnalysisOpen = analysisPanelOpen;
    const hadSelectionOpen = Boolean(activeSelectionTooltipContext);
    hideSentenceAnalysis();
    if (hadAnalysisOpen || hadSelectionOpen) {
      hideTooltip();
    }
    return;
  }

  cancelActiveAsyncRequests();
  hideSentenceAnalysis();
  renderSelectionTooltip(context);
  void requestSelectionTranslation("google", context);
}

tooltip.card.addEventListener("mouseenter", () => {
  tooltipHovered = true;
  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }
});

tooltip.card.addEventListener("mouseleave", () => {
  tooltipHovered = false;
  scheduleHide();
});

tooltip.analysisTriggerButton.addEventListener("mousedown", (event) => {
  event.preventDefault();
  suppressSelectionTriggerUntil = Date.now() + 800;
});

tooltip.analysisTriggerButton.addEventListener("click", async () => {
  if (!activeSelectionContext) {
    return;
  }

  suppressSelectionTriggerUntil = Date.now() + 1500;
  await requestSentenceAnalysis(activeSelectionContext);
});

tooltip.selectionAnalysisButton.addEventListener("click", async () => {
  if (!activeSelectionContext) {
    return;
  }

  if (!isAnalyzableSelectionText(activeSelectionContext.text)) {
    tooltip.hintEl.dataset.visible = "true";
    tooltip.hintEl.dataset.loading = "false";
    tooltip.hintEl.textContent = "这段内容太短，更适合直接看翻译。";
    return;
  }

  suppressSelectionTriggerUntil = Date.now() + 1500;
  cancelActiveAsyncRequests();
  await requestSentenceAnalysis(activeSelectionContext);
});

tooltip.button.addEventListener("click", async () => {
  if (!activeResult?.lemma) {
    return;
  }

  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_MASTERED",
      payload: {
        lemma: activeResult.lemma,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (response.ok) {
    currentSettings = response.settings ?? currentSettings;
    activeRequestId += 1;
    hideTooltip();
    await refreshHighlightsNow();
  }
});

tooltip.llmButton.addEventListener("click", async () => {
  if (activeSelectionTooltipContext) {
    await requestSelectionTranslation("llm", activeSelectionTooltipContext);
    return;
  }

  await requestTranslation("llm");
});

tooltip.britishButton.addEventListener("click", async () => {
  await speakPronunciation("en-GB");
});

tooltip.americanButton.addEventListener("click", async () => {
  await speakPronunciation("en-US");
});

tooltip.ignoreButton.addEventListener("click", async () => {
  if (!activeResult?.lemma) {
    return;
  }

  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_IGNORED",
      payload: {
        lemma: activeResult.lemma,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (response.ok) {
    currentSettings = response.settings ?? currentSettings;
    activeRequestId += 1;
    hideTooltip();
    await refreshHighlightsNow();
  }
});

document.addEventListener(
  "mousemove",
  (event) => {
    const path = event.composedPath();
    if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
      return;
    }

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    const context = getHoverContext(event.clientX, event.clientY);
    const pointerProtected =
      tooltip.host.style.display === "block" &&
      (isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY) ||
        isPointerInTooltipCorridor(event.clientX, event.clientY));

    if (pointerProtected && context && isSameHoverTarget(context)) {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
      return;
    }

    if (!context) {
      if (
        isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY) ||
        isPointerInTooltipCorridor(event.clientX, event.clientY)
      ) {
        return;
      }

      if (tooltip.host.style.display === "block") {
        scheduleHide();
        return;
      }

      scheduleHide();
      return;
    }

    scheduleLookup(context);
  },
  { passive: true },
);

document.addEventListener("mouseup", (event) => {
  const path = event.composedPath();

  if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
    return;
  }

  if (event.detail >= 2) {
    suppressSelectionTriggerUntil = Date.now() + 500;
    return;
  }

  window.setTimeout(() => {
    updateSelectionAnalysisTrigger();
  }, 0);
});

document.addEventListener("keyup", (event) => {
  if (Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  if (event.key === "Shift" || event.key.startsWith("Arrow")) {
    window.setTimeout(() => {
      updateSelectionAnalysisTrigger();
    }, 0);
  }
});

document.addEventListener("dblclick", () => {
  window.setTimeout(() => {
    const context = getSelectedWordContext();

    if (!context) {
      return;
    }

    void (async () => {
      const changed = await markWordForReview(context.surface);

      if (!changed) {
        return;
      }

      await resolveHoverWord(context);
    })();
  }, 0);
});

document.addEventListener("scroll", () => {
  if (activeSelectionTooltipContext && tooltip.host.style.display === "block") {
    positionTooltip(activeSelectionTooltipContext.rect);
  } else if (tooltip.host.style.display === "block") {
    const context = getHoverContext(lastMouseX, lastMouseY);
    if (context) {
      positionTooltip(context.rect);
    }
  }

  if (analysisPanelOpen && activeSelectionContext) {
    positionSentenceAnalysisPanel(activeSelectionContext.rect);
  } else if (activeSelectionContext) {
    positionSentenceAnalysisButton(activeSelectionContext.rect);
  }

  scheduleHighlightRefresh();
});

window.addEventListener("resize", () => {
  if (activeSelectionTooltipContext && tooltip.host.style.display === "block") {
    positionTooltip(activeSelectionTooltipContext.rect);
  }

  if (analysisPanelOpen && activeSelectionContext) {
    positionSentenceAnalysisPanel(activeSelectionContext.rect);
  } else if (activeSelectionContext) {
    positionSentenceAnalysisButton(activeSelectionContext.rect);
  }
  scheduleHighlightRefresh();
});

window.addEventListener("blur", () => {
  hideTooltip();
  hideSentenceAnalysis();
});

window.addEventListener("focus", () => {
  scheduleHighlightRefresh();
});

document.addEventListener("pointerdown", (event) => {
  const path = event.composedPath();

  if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
    return;
  }

  hideTooltip();
  hideSentenceAnalysis();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
    hideSentenceAnalysis();
  }
});

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== "sync" || !changes.userSettings) {
    return;
  }

  currentSettings = (changes.userSettings.newValue as UserSettings | undefined) ?? DEFAULT_SETTINGS;
  scheduleHighlightRefresh();
});

const mutationObserver = new MutationObserver(() => {
  scheduleHighlightRefresh();
});

function startObservers() {
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startObservers();
    scheduleHighlightRefresh();
  });
} else {
  startObservers();
  scheduleHighlightRefresh();
}
