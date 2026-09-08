import { lookupRank, resolveLookupLemma, resolveMasteryKey } from "../shared/lexicon";
import { findLearningPhraseMatches } from "../shared/phrases";
import { getHighlightIntensity } from "../shared/settings";
import { createEnglishTokenMatcher } from "../shared/word";
import type { HighlightIntensity, UserSettings } from "../shared/types";

export const PENDING_HIGHLIGHT_NAMES: Record<Exclude<HighlightIntensity, "none">, string> = {
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

interface Candidate {
  surface: string;
  key: string;
  start: number;
  end: number;
  phrasePriority?: 1 | 2 | 3;
}

const MAX_TOTAL_RANGES = 1800;
const MAX_NODES_PER_CHUNK = 120;
const MAX_CHUNK_MS = 8;

function supportsHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function rangeSize(ranges?: NodeRanges): number {
  return ranges ? ranges.strong.length + ranges.normal.length + ranges.weak.length : 0;
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
  const nodeOccurrenceCounts = new Map<Text, Map<string, number>>();
  const nodesByKey = new Map<string, Set<Text>>();
  const viewportNodes = new Map<Element, Set<Text>>();
  let fullScanWalker: TreeWalker | null = null;
  let processing = false;
  let generation = 0;
  let totalRangeCount = 0;

  const viewportObserver = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) {
            continue;
          }
          const element = entry.target as Element;
          const nodes = viewportNodes.get(element);
          if (!nodes) {
            continue;
          }
          for (const node of nodes) {
            if (node.isConnected) {
              queuedNodes.add(node);
            }
          }
          viewportNodes.delete(element);
          viewportObserver?.unobserve(element);
        }
        scheduleProcessing();
      }, { rootMargin: "600px 0px" });

  function replaceNodeRanges(node: Text, next?: NodeRanges) {
    totalRangeCount -= rangeSize(nodeRanges.get(node));
    if (next && rangeSize(next)) {
      nodeRanges.set(node, next);
      totalRangeCount += rangeSize(next);
    } else {
      nodeRanges.delete(node);
    }
  }

  function publishHighlights() {
    if (!supportsHighlights()) {
      return;
    }

    const strong = new Highlight();
    const normal = new Highlight();
    const weak = new Highlight();

    for (const [node, ranges] of [...nodeRanges]) {
      if (!node.isConnected) {
        replaceNodeRanges(node);
        updateNodeOccurrences(node, new Map());
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
    processing = false;
    totalRangeCount = 0;
    queuedNodes.clear();
    nodeRanges.clear();
    articleCounts.clear();
    nodeOccurrenceCounts.clear();
    nodesByKey.clear();
    viewportNodes.clear();
    viewportObserver?.disconnect();
    if (supportsHighlights()) {
      for (const name of Object.values(PENDING_HIGHLIGHT_NAMES)) {
        CSS.highlights.delete(name);
      }
    }
  }

  function updateNodeOccurrences(node: Text, next: Map<string, number>) {
    const previous = nodeOccurrenceCounts.get(node) ?? new Map<string, number>();
    const keys = new Set([...previous.keys(), ...next.keys()]);

    for (const key of keys) {
      const beforeNode = previous.get(key) ?? 0;
      const afterNode = next.get(key) ?? 0;
      const delta = afterNode - beforeNode;
      if (!delta) {
        continue;
      }

      const beforeArticle = articleCounts.get(key) ?? 0;
      const afterArticle = Math.max(0, beforeArticle + delta);
      if (afterArticle) {
        articleCounts.set(key, afterArticle);
      } else {
        articleCounts.delete(key);
      }

      let relatedNodes = nodesByKey.get(key);
      if (afterNode > 0) {
        relatedNodes ??= new Set<Text>();
        relatedNodes.add(node);
        nodesByKey.set(key, relatedNodes);
      } else if (relatedNodes) {
        relatedNodes.delete(node);
        if (!relatedNodes.size) {
          nodesByKey.delete(key);
        }
      }

      // Article-local repetition is a learning-priority signal. Upgrade earlier
      // occurrences once when the real occurrence count crosses the threshold;
      // reprocessing the same node has delta=0 and cannot inflate this count.
      if (beforeArticle < 3 && afterArticle >= 3) {
        for (const relatedNode of nodesByKey.get(key) ?? []) {
          if (relatedNode !== node) {
            queuedNodes.add(relatedNode);
          }
        }
      }
    }

    if (next.size) {
      nodeOccurrenceCounts.set(node, next);
    } else {
      nodeOccurrenceCounts.delete(node);
    }
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
    intensity: Exclude<HighlightIntensity, "none">,
    node: Text,
    start: number,
    end: number,
    available: number,
  ): number {
    if (available <= 0) {
      return 0;
    }
    const range = makeRange(node, start, end);
    if (!range) {
      return 0;
    }
    ranges[intensity].push(range);
    return 1;
  }

  async function processNode(node: Text, settings: UserSettings) {
    if (!node.isConnected || options.shouldSkipTextNode(node)) {
      replaceNodeRanges(node);
      updateNodeOccurrences(node, new Map());
      return;
    }

    const text = node.textContent ?? "";
    if (!text.trim()) {
      replaceNodeRanges(node);
      updateNodeOccurrences(node, new Map());
      return;
    }

    const candidates: Candidate[] = [];
    const occupied: Array<{ start: number; end: number }> = [];

    for (const phrase of findLearningPhraseMatches(text)) {
      const lemma = resolveLookupLemma(phrase.surface);
      const context = options.getTokenContext(node, phrase.start, phrase.end, phrase.surface);
      if (!options.shouldTranslateToken(phrase.surface, lemma, null, settings, context)) {
        continue;
      }
      candidates.push({
        surface: phrase.surface,
        key: resolveMasteryKey(phrase.surface),
        start: phrase.start,
        end: phrase.end,
        phrasePriority: phrase.priority,
      });
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

      candidates.push({
        surface,
        key: resolveMasteryKey(surface),
        start,
        end,
      });
    }

    const occurrenceCounts = new Map<string, number>();
    for (const candidate of candidates) {
      occurrenceCounts.set(candidate.key, (occurrenceCounts.get(candidate.key) ?? 0) + 1);
    }
    updateNodeOccurrences(node, occurrenceCounts);

    const ranges = createEmptyRanges();
    const oldNodeRanges = rangeSize(nodeRanges.get(node));
    let available = Math.max(0, MAX_TOTAL_RANGES - (totalRangeCount - oldNodeRanges));

    for (const candidate of candidates) {
      const articleOccurrences = articleCounts.get(candidate.key) ?? 1;
      if (candidate.phrasePriority && candidate.phrasePriority < 3 && articleOccurrences < 2) {
        continue;
      }
      const intensity = getHighlightIntensity(settings, candidate.surface, articleOccurrences);
      if (intensity === "none") {
        continue;
      }
      const added = addRange(
        ranges,
        intensity,
        node,
        candidate.start,
        candidate.end,
        available,
      );
      available -= added;
      if (available <= 0) {
        break;
      }
    }

    replaceNodeRanges(node, ranges);
  }

  function registerTextNode(node: Text) {
    if (!node.isConnected || options.shouldSkipTextNode(node)) {
      return;
    }

    if (!viewportObserver) {
      queuedNodes.add(node);
      return;
    }

    const element = node.parentElement;
    if (!element) {
      queuedNodes.add(node);
      return;
    }

    let nodes = viewportNodes.get(element);
    if (!nodes) {
      nodes = new Set<Text>();
      viewportNodes.set(element, nodes);
      viewportObserver.observe(element);
    }
    nodes.add(node);
  }

  function registerTextNodes(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
      registerTextNode(root as Text);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      registerTextNode(current as Text);
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
        performance.now() - started < MAX_CHUNK_MS
      ) {
        const queued = queuedNodes.values().next().value as Text | undefined;
        if (queued) {
          queuedNodes.delete(queued);
          await processNode(queued, settings);
          processedNodes += 1;
          continue;
        }

        if (!fullScanWalker) {
          break;
        }

        const discovered = fullScanWalker.nextNode() as Text | null;
        if (!discovered) {
          fullScanWalker = null;
          break;
        }
        registerTextNode(discovered);
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

  function removeNodeTree(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) {
      const node = root as Text;
      replaceNodeRanges(node);
      updateNodeOccurrences(node, new Map());
      queuedNodes.delete(node);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      replaceNodeRanges(node);
      updateNodeOccurrences(node, new Map());
      queuedNodes.delete(node);
      current = walker.nextNode();
    }
  }

  function handleMutations(records: MutationRecord[]) {
    for (const record of records) {
      if (record.type === "characterData") {
        const node = record.target as Text;
        // Already-visible changed text should update immediately; it has already
        // passed the viewport gate once.
        queuedNodes.add(node);
        continue;
      }
      for (const removed of record.removedNodes) {
        removeNodeTree(removed);
      }
      for (const added of record.addedNodes) {
        registerTextNodes(added);
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
