import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type { LookupWordResponse, RuntimeMessage, SettingsResponse } from "../shared/messages";
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

  const metaEl = document.createElement("div");
  metaEl.className = "wordwise-meta";

  const rankEl = document.createElement("span");
  rankEl.className = "wordwise-rank";

  const button = document.createElement("button");
  button.className = "wordwise-button";
  button.textContent = "已掌握";

  metaEl.append(rankEl, button);
  card.append(surfaceEl, translationEl, metaEl);
  shadow.append(style, card);
  document.documentElement.append(host);

  return { host, card, surfaceEl, translationEl, rankEl, button };
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

  activeRequestId += 1;

  return {
    surface,
    rect,
    requestId: activeRequestId,
    forceTranslate: true,
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
let currentSettings: UserSettings | null = null;
let tooltipHovered = false;
let lastMouseX = 0;
let lastMouseY = 0;

function hideTooltip() {
  tooltip.host.style.display = "none";
  activeResult = null;
  activeAnchorRect = null;
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
    if (!tooltipHovered) {
      hideTooltip();
    }
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

function renderTooltip(result: LexiconLookupResult, rect: DOMRect) {
  if (!result.translation) {
    hideTooltip();
    return;
  }

  tooltip.surfaceEl.textContent = result.surface;
  tooltip.translationEl.textContent = result.translation;
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

  renderTooltip(response.result, context.rect);
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

document.addEventListener(
  "mousemove",
  (event) => {
    const path = event.composedPath();
    if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
      return;
    }

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    const context = getHoverContext(event.clientX, event.clientY);

    if (!context) {
      if (
        isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY)
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
