import { lookupRank, resolveLookupLemma, resolveMasteryKey } from "../shared/lexicon";
import { findLearningPhraseMatches } from "../shared/phrases";
import { getHighlightIntensity } from "../shared/settings";
import { createEnglishTokenMatcher } from "../shared/word";
import type { HighlightIntensity, UserSettings } from "../shared/types";

export const PENDING_HIGHLIGHT_NAMES: Record<HighlightIntensity, string> = {
  strong: "wordwise-pending-strong",
  normal: "wordwise-pending",
  weak: "wordwise-pending-weak",
};

interface EngineOptions {
  getSettings: () => Promise<UserSettings>;
  shouldSkipTextNode: (node: Text) => boolean;
  getTokenContext: (node: Text, start: number, end: number, fallback: string) => string;
  shouldTranslateToken: (
    surface: string,
    lemma: string,
    rank: number | null,
    settings: UserSettings,
    contextText: string,
  ) => boolean;
}

interface NodeRanges {
  strong: Range[];
  normal: Range[];
  weak: Range[];
}

const MAX_TOTAL_RANGES = 1800;
const MAX_NODES_PER_CHUNK = 120;
const MAX_CHUNK_MS = 8;

function supportsHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function createEmptyRanges(): NodeRanges {
  return { strong: [], normal: [], weak: [] };
}

function isTechnicalBoundaryCharacter(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_@/\\]/u.test(char));
}

function isEmbeddedInTechnicalToken(text: string, start: number, end: number): boolean {
  if (isTechnicalBoundaryCharacter(text[start - 1]) || isTechnicalBoundaryCharacter(text[end])) {
    return true;
  }
  if (text[start - 1] === "." || (text[end] === "." && /[A-Za-z0-9]/u.test(text[end + 1] ?? ""))) {
    return true;
  }
  if ((text[end] === ":" && text[end + 1] === "/") || (text[start - 1] === "/" && text[start - 2] === ":")) {
    return true;
  }
  return false;
}

export function createIncrementalHighlightEngine(options: EngineOptions) {
  const nodeRanges = new Map<Text, NodeRanges>();
  const queuedNodes = new Set<Text>();
  const articleCounts = new Map<string, number>();
  const nodesByKey = new Map<string, Set<Text>>();
  let fullScanWalker: TreeWalker | null = null;
  let processing = false;
  let generation = 0;

  function totalRanges(): number {
    let total = 0;
    for (const ranges of nodeRanges.values()) {
      total += ranges.strong.length + ranges.normal.length + ranges.weak.length;
    }
    return total;
  }

  function publishHighlights() {
    if (!supportsHighlights()) {
      return;
    }

    const strong = new Highlight();
    const normal = new Highlight();
    const weak = new Highlight();

    for (const [node, ranges] of nodeRanges) {
      if (!node.isConnected) {
        nodeRanges.delete(node);
        continue;
      }
      for (const range of ranges.strong) strong.add(range);
      for (const range of ranges.normal) normal.add(range);
      for (const range of ranges.weak) weak.add(range);
    }

    CSS.highlights.set(PENDING_HIGHLIGHT_NAMES.strong, strong);
    CSS.highlights.set(PENDING_HIGHLIGHT_NAMES.normal, normal);
    CSS.highlights.set(PENDING_HIGHLIGHT_NAMES.weak, weak);
  }

  function clear() {
    generation += 1;
    fullScanWalker = null;
    queuedNodes.clear();
    nodeRanges.clear();
    articleCounts.clear();
    nodesByKey.clear();
    if (supportsHighlights()) {
      for (const name of Object.values(PENDING_HIGHLIGHT_NAMES)) {
        CSS.highlights.delete(name);
      }
    }
  }

  function rememberKeyNode(key: string, node: Text) {
    let nodes = nodesByKey.get(key);
    if (!nodes) {
      nodes = new Set<Text>();
      nodesByKey.set(key, nodes);
    }
    nodes.add(node);
  }

  function incrementArticleCount(key: string, node: Text): number {
    const next = (articleCounts.get(key) ?? 0) + 1;
    articleCounts.set(key, next);
    rememberKeyNode(key, node);

    // When a word becomes locally repeated, re-evaluate earlier occurrences so
    // the visual priority upgrades consistently across the article.
    if (next === 3) {
      for (const relatedNode of nodesByKey.get(key) ?? []) {
        queuedNodes.add(relatedNode);
      }
    }
    return next;
  }

  function makeRange(node: Text, start: number, end: number): Range | null {
    if (end <= start || start < 0 || end > (node.textContent?.length ?? 0)) {
      return null;
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  }

  function addRange(
    ranges: NodeRanges,
    intensity: HighlightIntensity,
    node: Text,
    start: number,
    end: number,
  ) {
    const range = makeRange(node, start, end);
    if (range) {
      ranges[intensity].push(range);
    }
  }

  async function processNode(node: Text, settings: UserSettings) {
    if (!node.isConnected || options.shouldSkipTextNode(node)) {
      nodeRanges.delete(node);
      return;
    }

    const text = node.textContent ?? "";
    if (!text.trim()) {
      nodeRanges.delete(node);
      return;
    }

    const ranges = createEmptyRanges();
    const occupied: Array<{ start: number; end: number }> = [];

    for (const phrase of findLearningPhraseMatches(text)) {
      const lemma = resolveLookupLemma(phrase.surface);
      const context = options.getTokenContext(node, phrase.start, phrase.end, phrase.surface);
      if (!options.shouldTranslateToken(phrase.surface, lemma, null, settings, context)) {
        continue;
      }

      const key = resolveMasteryKey(phrase.surface);
      const occurrences = incrementArticleCount(key, node);
      // Curated high-priority phrases can appear once; lower-priority phrases
      // become automatic targets after repetition to avoid visual noise.
      if (phrase.priority < 3 && occurrences < 2) {
        continue;
      }
      const intensity = getHighlightIntensity(settings, phrase.surface, occurrences);
      addRange(ranges, intensity, node, phrase.start, phrase.end);
      occupied.push({ start: phrase.start, end: phrase.end });
    }

    const matcher = createEnglishTokenMatcher();
    let match = matcher.exec(text);
    while (match) {
      const surface = match[0];
      const start = match.index;
      const end = start + surface.length;
      match = matcher.exec(text);

      if (occupied.some((range) => start < range.end && end > range.start)) {
        continue;
      }
      if (isEmbeddedInTechnicalToken(text, start, end)) {
        continue;
      }

      const lemma = resolveLookupLemma(surface);
      const rank = lemma ? lookupRank(lemma) : null;
      const context = options.getTokenContext(node, start, end, surface);
      if (!options.shouldTranslateToken(surface, lemma, rank, settings, context)) {
        continue;
      }

      const key = resolveMasteryKey(surface);
      const occurrences = incrementArticleCount(key, node);
      const intensity = getHighlightIntensity(settings, surface, occurrences);
      addRange(ranges, intensity, node, start, end);

      if (totalRanges() + ranges.strong.length + ranges.normal.length + ranges.weak.length >= MAX_TOTAL_RANGES) {
        break;
      }
    }

    if (ranges.strong.length || ranges.normal.length || ranges.weak.length) {
      nodeRanges.set(node, ranges);
    } else {
      nodeRanges.delete(node);
    }
  }

  function enqueueTextNodes(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
      queuedNodes.add(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      queuedNodes.add(current as Text);
      current = walker.nextNode();
    }
  }

  function scheduleProcessing() {
    if (processing || !supportsHighlights()) {
      return;
    }
    processing = true;
    const expectedGeneration = generation;

    const run = async () => {
      if (expectedGeneration !== generation) {
        processing = false;
        return;
      }

      const settings = await options.getSettings();
      const started = performance.now();
      let processedNodes = 0;

      while (
        processedNodes < MAX_NODES_PER_CHUNK &&
        performance.now() - started < MAX_CHUNK_MS &&
        totalRanges() < MAX_TOTAL_RANGES
      ) {
        let node = queuedNodes.values().next().value as Text | undefined;
        if (node) {
          queuedNodes.delete(node);
        } else if (fullScanWalker) {
          node = fullScanWalker.nextNode() as Text | null ?? undefined;
          if (!node) {
            fullScanWalker = null;
            break;
          }
        } else {
          break;
        }

        await processNode(node, settings);
        processedNodes += 1;
      }

      publishHighlights();
      processing = false;

      if (queuedNodes.size || fullScanWalker) {
        window.setTimeout(scheduleProcessing, 0);
      }
    };

    void run();
  }

  function refreshAll() {
    clear();
    if (!document.body || !supportsHighlights()) {
      return;
    }
    fullScanWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node instanceof Text && !options.shouldSkipTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    scheduleProcessing();
  }

  function handleMutations(records: MutationRecord[]) {
    for (const record of records) {
      if (record.type === "characterData") {
        enqueueTextNodes(record.target);
        continue;
      }
      for (const removed of record.removedNodes) {
        if (removed.nodeType === Node.TEXT_NODE) {
          nodeRanges.delete(removed as Text);
        }
      }
      for (const added of record.addedNodes) {
        enqueueTextNodes(added);
      }
    }
    scheduleProcessing();
  }

  return {
    clear,
    refreshAll,
    handleMutations,
    scheduleProcessing,
  };
}
