import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type {
  LookupWordResponse,
  RuntimeMessage,
  SettingsResponse,
  TranslationProviderChoice,
} from "../shared/messages";
import { DEFAULT_SETTINGS, resolveWordFlags } from "../shared/settings";
import { getSettings } from "../shared/storage";
import type { LexiconLookupResult, UserSettings } from "../shared/types";

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
    max-width: 320px;
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
  .wordwise-surface {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 4px;
    color: #10213a;
  }
  .wordwise-translation {
    font-size: 14px;
    line-height: 1.5;
    color: #1f2937;
    margin-bottom: 8px;
    display: none;
  }
  .wordwise-translation[data-visible="true"] {
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
`;

const HIGHLIGHT_STYLE = `
  ::highlight(${HIGHLIGHT_NAME}) {
    background: rgba(250, 204, 21, 0.28);
    font-weight: 600;
  }
`;

interface HoverContext {
  surface: string;
  rect: DOMRect;
  requestId: number;
  forceTranslate?: boolean;
  contextText?: string;
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

function isSingleEnglishWord(surface: string): boolean {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(surface.trim());
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

  const translationEl = document.createElement("div");
  translationEl.className = "wordwise-translation";
  translationEl.dataset.visible = "false";

  const hintEl = document.createElement("div");
  hintEl.className = "wordwise-hint";
  hintEl.dataset.visible = "true";
  hintEl.textContent = "默认使用 Google 翻译，不满意可切换到 LLM。";

  const actionsEl = document.createElement("div");
  actionsEl.className = "wordwise-actions";

  const googleButton = document.createElement("button");
  googleButton.className = "wordwise-button wordwise-button--secondary";
  googleButton.textContent = "Google 翻译";

  const llmButton = document.createElement("button");
  llmButton.className = "wordwise-button wordwise-button--secondary";
  llmButton.textContent = "LLM 翻译";

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

  actionsEl.append(googleButton, llmButton, ignoreButton, button);
  metaEl.append(rankEl);
  card.append(surfaceEl, hintEl, translationEl, actionsEl, metaEl);
  shadow.append(style, card);
  document.documentElement.append(host);

  return {
    host,
    card,
    surfaceEl,
    hintEl,
    translationEl,
    rankEl,
    button,
    googleButton,
    llmButton,
    ignoreButton,
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

function isIgnoredContainer(node: Node): boolean {
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
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function isExtensionContextInvalidated(error: unknown): boolean {
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

function hideTooltip() {
  tooltip.host.style.display = "none";
  activeResult = null;
  activeAnchorRect = null;
  activeContext = null;
  activeTranslationRequestId += 1;
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
  tooltip.surfaceEl.textContent = result.surface;
  tooltip.translationEl.textContent = result.translation ?? "";
  tooltip.translationEl.dataset.visible = result.translation ? "true" : "false";
  tooltip.hintEl.dataset.visible = result.translation ? "false" : "true";
  if (!result.translation) {
    tooltip.hintEl.textContent = "默认使用 Google 翻译，不满意可切换到 LLM。";
  }
  tooltip.rankEl.textContent = rankLabel(result);
  tooltip.host.style.display = "block";
  activeAnchorRect = rect;
  positionTooltip(rect);
  activeResult = result;
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

      if (text[match.index - 1] === "@") {
        match = matcher.exec(text);
        continue;
      }

      const lemma = resolveLookupLemma(surface);
      const rank = lemma ? lookupRank(lemma) : null;
      const flags = resolveWordFlags(lemma, rank, settings, surface);

      if (flags.shouldTranslate) {
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + surface.length);
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
  tooltip.hintEl.dataset.visible = "true";
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
    tooltip.hintEl.textContent =
      providerLabel === "Google" ? "默认 Google 结果，不满意可试试 LLM。" : "已使用 LLM 翻译。";
  }
}

async function requestTranslationForContext(
  provider: TranslationProviderChoice,
  context: HoverContext,
) {
  activeContext = context;
  await requestTranslation(provider);
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

tooltip.googleButton.addEventListener("click", async () => {
  await requestTranslation("google");
});

tooltip.llmButton.addEventListener("click", async () => {
  await requestTranslation("llm");
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

    if (
      tooltip.host.style.display === "block" &&
      (isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY) ||
        isPointerInTooltipCorridor(event.clientX, event.clientY))
    ) {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
      return;
    }

    const context = getHoverContext(event.clientX, event.clientY);

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
      await requestTranslationForContext("llm", context);
    })();
  }, 0);
});

document.addEventListener("scroll", () => {
  if (tooltip.host.style.display === "block") {
    const context = getHoverContext(lastMouseX, lastMouseY);
    if (context) {
      positionTooltip(context.rect);
    }
  }

  scheduleHighlightRefresh();
});

window.addEventListener("resize", () => {
  scheduleHighlightRefresh();
});

window.addEventListener("blur", () => {
  hideTooltip();
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
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
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
