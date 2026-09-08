import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceExact(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Missing patch target: ${label}`);
  }
  return text.replace(search, replacement);
}

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker: ${label}`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing end marker: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

// ---- content script -------------------------------------------------------
{
  const path = "src/content/index.ts";
  let text = read(path);

  text = replaceExact(
    text,
    'import { lookupRank, resolveLookupLemma } from "../shared/lexicon";\n',
    'import { lookupRank, resolveLookupLemma } from "../shared/lexicon";\nimport { findLearningPhraseAtOffset } from "../shared/phrases";\nimport { createIncrementalHighlightEngine, PENDING_HIGHLIGHT_NAMES } from "./highlightEngine";\n',
    "content imports",
  );

  text = replaceExact(
    text,
    'let activeDisplayedTranslationProvider: TranslationProviderChoice = "google";\n',
    'let activeDisplayedTranslationProvider: TranslationProviderChoice = "google";\nlet highlightEngine: ReturnType<typeof createIncrementalHighlightEngine> | null = null;\n',
    "highlight engine state",
  );

  text = replaceBetween(
    text,
    "const HIGHLIGHT_STYLE = `",
    "const SPEAKER_ICON = `",
    `const HIGHLIGHT_STYLE = \`\n  ::highlight(wordwise-pending-strong) {\n    background: rgba(250, 204, 21, 0.4);\n    font-weight: 700;\n  }\n  ::highlight(wordwise-pending) {\n    background: rgba(250, 204, 21, 0.28);\n    font-weight: 600;\n  }\n  ::highlight(wordwise-pending-weak) {\n    background: rgba(250, 204, 21, 0.13);\n    font-weight: 500;\n  }\n\`;\n\n`,
    "highlight styles",
  );

  text = replaceBetween(
    text,
    "function extractSentenceAroundRange(",
    "function extractContextAroundDomRange(",
    `function extractSentenceAroundRange(text: string, start: number, end: number): string {\n  const compactText = text.replace(/\\u00a0/g, " ");\n\n  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {\n    try {\n      const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });\n      for (const segment of segmenter.segment(compactText)) {\n        const segmentStart = segment.index;\n        const segmentEnd = segmentStart + segment.segment.length;\n        if (start >= segmentStart && end <= segmentEnd) {\n          const sentence = segment.segment.trim();\n          if (sentence) return sentence;\n        }\n      }\n    } catch {\n      // Fall through to punctuation-based segmentation for older engines.\n    }\n  }\n\n  const leftBoundary = Math.max(\n    compactText.lastIndexOf(".", start - 1),\n    compactText.lastIndexOf("!", start - 1),\n    compactText.lastIndexOf("?", start - 1),\n    compactText.lastIndexOf("\\n", start - 1),\n  );\n  const rightCandidates = [\n    compactText.indexOf(".", end),\n    compactText.indexOf("!", end),\n    compactText.indexOf("?", end),\n    compactText.indexOf("\\n", end),\n  ].filter((value) => value >= 0);\n  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : compactText.length;\n  const sentence = compactText.slice(leftBoundary >= 0 ? leftBoundary + 1 : 0, rightBoundary).trim();\n  return sentence || compactText.slice(Math.max(0, start - 120), Math.min(compactText.length, end + 120)).trim();\n}\n\n`,
    "sentence segmentation",
  );

  text = replaceBetween(
    text,
    "function extractContextAroundDomRange(",
    "function escapeHtml(",
    `function extractContextAroundDomRange(range: Range, fallback: string): string {\n  let ancestor: Element | null =\n    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE\n      ? range.commonAncestorContainer as Element\n      : range.commonAncestorContainer.parentElement;\n  let bestCandidate = "";\n\n  // Prefer a logical ancestor sentence over a single inline text node. Modern\n  // pages frequently split one sentence across links, strong tags, and spans.\n  for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {\n    if (isIgnoredContainer(ancestor)) continue;\n    const text = ancestor.textContent ?? "";\n    const compact = normalizeSelectionText(text);\n    if (!compact || compact.length > 1800) continue;\n\n    try {\n      const prefixRange = document.createRange();\n      prefixRange.selectNodeContents(ancestor);\n      prefixRange.setEnd(range.startContainer, range.startOffset);\n      const start = prefixRange.toString().length;\n      const selectionLength = range.toString().length;\n      const candidate = extractSentenceAroundRange(text, start, start + selectionLength);\n      const wordCount = countEnglishWords(candidate);\n      if (wordCount < 2) continue;\n      bestCandidate = normalizeSelectionText(candidate);\n      if (wordCount >= 4 || /\\bby\\s+[A-Za-z]/i.test(candidate)) {\n        return bestCandidate;\n      }\n    } catch {\n      continue;\n    }\n  }\n\n  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer === range.endContainer) {\n    const textNode = range.startContainer as Text;\n    const localText = textNode.textContent ?? "";\n    const localSentence = extractSentenceAroundRange(localText, range.startOffset, range.endOffset);\n    if (countEnglishWords(localSentence) >= 2) return normalizeSelectionText(localSentence);\n  }\n\n  return bestCandidate || fallback;\n}\n\n`,
    "DOM context extraction",
  );

  text = replaceBetween(
    text,
    "function isAnalyzableSelectionText(",
    "const HIGHLIGHT_CATEGORY_META",
    `function isAnalyzableSelectionText(text: string): boolean {\n  const compact = normalizeSelectionText(text);\n  if (!compact || compact.length < 10 || compact.length > 1200) return false;\n  if (/[\\u4e00-\\u9fff]/u.test(compact)) return false;\n  const words = compact.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];\n  return words.length >= 3;\n}\n\n`,
    "analysis eligibility",
  );

  text = replaceBetween(
    text,
    "function buildHighlightAssignments(",
    "function renderSentenceMarkup(",
    `function buildHighlightAssignments(\n  result: SentenceAnalysisResult,\n  sentence: string,\n): Map<number, keyof typeof HIGHLIGHT_CATEGORY_META> {\n  const tokens = tokenizeSentenceWords(sentence);\n  const assignments = new Map<number, keyof typeof HIGHLIGHT_CATEGORY_META>();\n\n  for (const item of result.highlights) {\n    const normalized = normalizeHighlightWord(item.text);\n    if (!normalized || POSSESSIVE_DETERMINER_WORDS.has(normalized)) continue;\n\n    if (Number.isInteger(item.tokenIndex)) {\n      const token = tokens[item.tokenIndex as number];\n      if (token && token.normalized === normalized && !assignments.has(token.index)) {\n        assignments.set(token.index, item.category);\n        continue;\n      }\n    }\n\n    // Legacy/provider fallback only. New prompts return tokenIndex so repeated\n    // words such as multiple occurrences of "that" cannot be mis-highlighted.\n    assignFirstMatchingToken(\n      tokens,\n      assignments,\n      (token) => token.normalized === normalized,\n      item.category,\n    );\n  }\n\n  return assignments;\n}\n\n`,
    "token-index highlighting",
  );

  text = replaceBetween(
    text,
    "function clearHighlights()",
    "function scheduleHide()",
    `function clearHighlights() {\n  highlightEngine?.clear();\n  if (!("highlights" in CSS)) return;\n  for (const name of Object.values(PENDING_HIGHLIGHT_NAMES)) {\n    CSS.highlights.delete(name);\n  }\n}\n\n`,
    "clear highlights",
  );

  text = replaceBetween(
    text,
    "async function refreshHighlights()",
    "function clearSelectionTriggerTimer()",
    `async function refreshHighlights() {\n  highlightEngine?.refreshAll();\n}\n\nfunction scheduleHighlightRefresh() {\n  highlightEngine?.refreshAll();\n}\n\n`,
    "incremental highlighter bridge",
  );

  text = replaceExact(
    text,
    `function getHighlightTokenContext(textNode: Text, start: number, end: number, fallback: string): string {\n  const range = document.createRange();\n  range.setStart(textNode, start);\n  range.setEnd(textNode, end);\n  return extractContextAroundDomRange(range, fallback);\n}\n\nasync function resolveHoverWord`,
    `function getHighlightTokenContext(textNode: Text, start: number, end: number, fallback: string): string {\n  const range = document.createRange();\n  range.setStart(textNode, start);\n  range.setEnd(textNode, end);\n  return extractContextAroundDomRange(range, fallback);\n}\n\nhighlightEngine = createIncrementalHighlightEngine({\n  getSettings: ensureSettings,\n  shouldSkipTextNode,\n  getTokenContext: getHighlightTokenContext,\n  shouldTranslateToken: shouldTranslateHighlightToken,\n});\n\nasync function resolveHoverWord`,
    "highlight engine initialization",
  );

  text = replaceBetween(
    text,
    "function getHoverContext(",
    "async function updateSelectionAnalysisTrigger()",
    `function getHoverContext(clientX: number, clientY: number): HoverContext | null {\n  const caret = getCaretRangeFromPoint(clientX, clientY);\n  if (!caret || isIgnoredContainer(caret.node)) return null;\n\n  const text = caret.node.textContent ?? "";\n  const target = findLearningPhraseAtOffset(text, caret.offset) ?? extractWordAtOffset(text, caret.offset);\n  if (!target) return null;\n\n  const range = document.createRange();\n  range.setStart(caret.node, target.start);\n  range.setEnd(caret.node, target.end);\n  const rect = range.getBoundingClientRect();\n  if (!rect.width && !rect.height) return null;\n\n  const horizontalPadding = 1;\n  const verticalPadding = 2;\n  if (\n    clientX < rect.left - horizontalPadding || clientX > rect.right + horizontalPadding ||\n    clientY < rect.top - verticalPadding || clientY > rect.bottom + verticalPadding\n  ) return null;\n\n  activeRequestId += 1;\n  return {\n    surface: target.surface,\n    rect,\n    requestId: activeRequestId,\n    contextText: extractContextAroundDomRange(range, target.surface),\n  };\n}\n\n`,
    "phrase-aware hover",
  );

  text = replaceExact(
    text,
    "    const trimmedStart = rawSurface.search(/[A-Za-z']/);",
    "    const trimmedStart = rawSurface.search(/[A-Za-z'’]/);",
    "curly apostrophe selection range",
  );

  text = replaceExact(
    text,
    `const mutationObserver = new MutationObserver(() => {\n  scheduleHighlightRefresh();\n});`,
    `const mutationObserver = new MutationObserver((records) => {\n  highlightEngine?.handleMutations(records);\n});`,
    "incremental mutation observer",
  );

  text = replaceBetween(
    text,
    `document.addEventListener(\n  "scroll",`,
    `window.addEventListener("resize",`,
    `document.addEventListener(\n  "scroll",\n  () => {\n    if (tooltip.host.style.display === "block" && !isPersistentTooltipSession()) {\n      hideTooltip();\n      hideSentenceAnalysis();\n    }\n    // Highlight ranges remain valid while scrolling; no DOM rescan is needed.\n  },\n  { capture: true, passive: true },\n);\n\n`,
    "scroll handling",
  );

  text = replaceExact(
    text,
    `  scheduleHighlightRefresh();\n});\n\nwindow.addEventListener("blur",`,
    `});\n\nwindow.addEventListener("blur",`,
    "remove resize highlight rescan",
  );

  text = replaceExact(
    text,
    `window.addEventListener("focus", () => {\n  scheduleHighlightRefresh();\n});`,
    `window.addEventListener("focus", () => {\n  // Existing CSS Highlight ranges survive focus changes.\n});`,
    "remove focus highlight rescan",
  );

  write(path, text);
}

// ---- translator ----------------------------------------------------------
{
  const path = "src/shared/translator.ts";
  let text = read(path);

  text = replaceExact(
    text,
    "const SENTENCE_ANALYSIS_REQUEST_TIMEOUT_MS = 20000;",
    "const SENTENCE_ANALYSIS_REQUEST_TIMEOUT_MS = 25000;",
    "sentence timeout",
  );

  text = replaceExact(
    text,
    "Keep each backbone clause within about 200 English words.",
    "Keep each backbone clause within about 20 English words.",
    "backbone length",
  );

  text = replaceExact(
    text,
    '    "4. highlights: output 5 to 8 strings in the format <category>|||<exact single word from sentence>. Allowed categories are [subject, predicate, nonfinite, conjunction, relative, preposition]. Choose structural signal words rather than ordinary content words. For medium or long sentences, prefer 6 to 8 highlights when possible. Each highlight must use the category that best matches the word\'s grammatical role in this sentence.",',
    '    "4. highlights: output 3 to 8 JSON objects shaped {category,text,tokenIndex}. tokenIndex is the zero-based index from the token list supplied with the sentence and must identify the exact occurrence. Allowed categories are [subject, predicate, nonfinite, conjunction, relative, preposition]. Use subject for the head word of the main-clause subject and predicate for the main finite verb, not an arbitrary word inside the phrase.",',
    "highlight prompt coordinates",
  );

  text = replaceExact(
    text,
    '    "5. clauseBlocks: output 2 to 6 strings in the format <type>|||<exact original text chunk>. Allowed types are [main, relative, subordinate, nonfinite, parallel, modifier]. The clauseBlocks must cover the whole sentence from first word to last word with no missing words and no overlap. Split long parts at commas, relative words, subordinators, coordinators, or nonfinite markers when that improves clarity, but do not isolate a bare preposition by itself.",',
    '    "5. clauseBlocks: output 2 to 10 strings in the format <type>|||<exact original text chunk>. Allowed types are [main, relative, subordinate, nonfinite, parallel, modifier]. The clauseBlocks must cover the whole sentence from first word to last word with no missing words and no overlap. Split long parts at commas, relative words, subordinators, coordinators, or nonfinite markers when that improves clarity, but do not isolate a bare preposition by itself.",',
    "clause block count",
  );

  text = replaceBetween(
    text,
    "function sanitizeAnalysisHighlights(",
    "const CLAUSE_BLOCK_TYPES",
    `function sanitizeAnalysisHighlights(input: unknown): SentenceHighlight[] {\n  if (!Array.isArray(input)) return [];\n\n  return input.map((item) => {\n    if (typeof item === "string") {\n      const parsedPair = parseAnalysisPair(item);\n      if (!parsedPair) return null;\n      const category = parsedPair.left as SentenceHighlightCategory;\n      const text = parsedPair.right;\n      if (!HIGHLIGHT_CATEGORIES.has(category)) return null;\n      return { text, category };\n    }\n\n    if (!item || typeof item !== "object") return null;\n    const object = item as { text?: unknown; category?: unknown; tokenIndex?: unknown };\n    const text = cleanModelOutput(typeof object.text === "string" ? object.text : "");\n    const category = typeof object.category === "string"\n      ? object.category as SentenceHighlightCategory\n      : null;\n    const tokenIndex = typeof object.tokenIndex === "number" && Number.isInteger(object.tokenIndex)\n      ? object.tokenIndex\n      : undefined;\n    const normalized = text.toLowerCase();\n    if (\n      !text || !category || !HIGHLIGHT_CATEGORIES.has(category) ||\n      (category !== "preposition" && ANALYSIS_PLAIN_PREPOSITIONS.has(normalized))\n    ) return null;\n    return tokenIndex !== undefined ? { text, category, tokenIndex } : { text, category };\n  }).filter((item): item is SentenceHighlight => Boolean(item));\n}\n\n`,
    "analysis highlight parsing",
  );

  text = replaceBetween(
    text,
    "function sentenceAnalysisNeedsRetry(",
    "async function requestSentenceAnalysis(",
    `interface AnalysisToken { index: number; text: string; start: number; end: number }\n\nfunction tokenizeSentenceForAnalysis(sentence: string): AnalysisToken[] {\n  const tokens: AnalysisToken[] = [];\n  const matcher = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;\n  let match = matcher.exec(sentence);\n  let index = 0;\n  while (match) {\n    tokens.push({ index, text: match[0], start: match.index, end: match.index + match[0].length });\n    index += 1;\n    match = matcher.exec(sentence);\n  }\n  return tokens;\n}\n\nfunction attachHighlightOffsets(\n  result: Omit<SentenceAnalysisResult, "provider" | "cached">,\n  sentence: string,\n): Omit<SentenceAnalysisResult, "provider" | "cached"> {\n  const tokens = tokenizeSentenceForAnalysis(sentence);\n  const used = new Set<number>();\n  const highlights = result.highlights.flatMap((item) => {\n    let token = Number.isInteger(item.tokenIndex) ? tokens[item.tokenIndex as number] : undefined;\n    if (!token || token.text.toLowerCase() !== item.text.toLowerCase()) {\n      token = tokens.find((candidate) =>\n        !used.has(candidate.index) && candidate.text.toLowerCase() === item.text.toLowerCase());\n    }\n    if (!token) return [];\n    used.add(token.index);\n    return [{ ...item, tokenIndex: token.index, start: token.start, end: token.end }];\n  });\n  return { ...result, highlights };\n}\n\nfunction clauseCoverageRatio(sentence: string, blocks: SentenceClauseBlock[]): number {\n  let cursor = 0;\n  let covered = 0;\n  for (const block of blocks) {\n    const value = block.text.trim();\n    if (!value) continue;\n    const start = sentence.indexOf(value, cursor);\n    if (start < 0) continue;\n    covered += value.length;\n    cursor = start + value.length;\n  }\n  return covered / Math.max(sentence.trim().length, 1);\n}\n\nfunction sentenceAnalysisNeedsRetry(\n  result: Omit<SentenceAnalysisResult, "provider" | "cached">,\n  sentence: string,\n): boolean {\n  const wordCount = tokenizeSentenceForAnalysis(sentence).length;\n  const minHighlights = wordCount <= 8 ? 1 : wordCount <= 16 ? 2 : 3;\n  const minBlocks = wordCount <= 8 ? 1 : 2;\n  if (result.highlights.length < minHighlights || result.clauseBlocks.length < minBlocks) return true;\n  if (result.highlights.some((item) => item.tokenIndex === undefined)) return true;\n  if (clauseCoverageRatio(sentence, result.clauseBlocks) < 0.9) return true;\n  const categories = new Set(result.highlights.map((item) => item.category));\n  return wordCount > 12 && categories.size < 2;\n}\n\n`,
    "analysis quality gate",
  );

  text = replaceBetween(
    text,
    "async function requestSentenceAnalysis(",
    "function buildLearnerLevelInstruction(",
    `async function requestSentenceAnalysis({\n  settings,\n  sentence,\n  systemPrompt,\n  qualityRetry = false,\n}: {\n  settings: TranslatorSettings;\n  sentence: string;\n  systemPrompt: string;\n  qualityRetry?: boolean;\n}): Promise<Omit<SentenceAnalysisResult, "provider" | "cached">> {\n  const tokens = tokenizeSentenceForAnalysis(sentence);\n  const tokenList = tokens.map((token) => \`${'${token.index}:${token.text}'}\`).join(" ");\n  const retryInstruction = qualityRetry\n    ? "\\nquality_retry: The previous attempt failed structural validation. Cover the entire source with exact clauseBlocks and use exact tokenIndex values for every highlight."\n    : "";\n  let llmResult: { content: string; finishReason: string; payload: unknown; response: Response };\n\n  try {\n    llmResult = await requestLlmText({\n      settings,\n      systemPrompt,\n      userPrompt: \`sentence: ${'${sentence}'}\\ntokens: ${'${tokenList}'}${'${retryInstruction}'}\`,\n      temperature: qualityRetry ? 0 : 0.1,\n      maxTokens: 1600,\n      timeoutMs: SENTENCE_ANALYSIS_REQUEST_TIMEOUT_MS,\n      preferJson: true,\n    });\n  } catch (error) {\n    throw new SentenceAnalysisRequestError(\n      error instanceof Error ? error.message : "LLM analysis request failed.",\n      { status: error instanceof LlmRequestError ? error.status : undefined, responseText: "", stage: qualityRetry ? "quality-retry" : "single-shot" },\n    );\n  }\n\n  const { content, finishReason, response } = llmResult;\n  if (isMaxTokenFinishReason(finishReason)) {\n    throw new SentenceAnalysisRequestError("Sentence analysis response was truncated by max tokens.", {\n      status: response.status, responseText: content.slice(0, 1600), stage: qualityRetry ? "quality-retry" : "single-shot",\n    });\n  }\n\n  try {\n    return attachHighlightOffsets(parseSentenceAnalysisResponse(content), sentence);\n  } catch (error) {\n    throw new SentenceAnalysisRequestError(\n      error instanceof Error ? error.message : "Sentence analysis parsing failed.",\n      { status: response.status, responseText: content.slice(0, 1600), stage: qualityRetry ? "quality-retry" : "single-shot" },\n    );\n  }\n}\n\n`,
    "analysis request with token coordinates",
  );

  text = replaceExact(
    text,
    "  const selection = trimContext(text);\n  const context = trimContext(contextText || text);",
    "  const selection = text.replace(/\\s+/g, \" \" ).trim().slice(0, 1200);\n  const context = trimContext(contextText || text);",
    "selection full-source preservation",
  );

  text = replaceBetween(
    text,
    "export async function analyzeSentenceWithLlm(",
    "export async function translateWithGoogle(",
    `export async function analyzeSentenceWithLlm({\n  text,\n  settings,\n}: {\n  text: string;\n  settings: TranslatorSettings;\n}): Promise<SentenceAnalysisResult> {\n  if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {\n    throw new Error(t(settings.learnerLanguageCode, "errorEnterApiKey"));\n  }\n\n  const sentence = text.replace(/\\s+/g, " ").trim().slice(0, 1200);\n  const analysisPrompt = buildSentenceAnalysisPrompt(settings);\n\n  try {\n    let result = await requestSentenceAnalysis({ settings, sentence, systemPrompt: analysisPrompt });\n    if (sentenceAnalysisNeedsRetry(result, sentence)) {\n      const retry = await requestSentenceAnalysis({\n        settings, sentence, systemPrompt: analysisPrompt, qualityRetry: true,\n      });\n      if (sentenceAnalysisNeedsRetry(retry, sentence)) {\n        throw new SentenceAnalysisFormatError("Sentence analysis failed structural quality validation.");\n      }\n      result = retry;\n    }\n\n    return { ...result, provider: getLlmProviderTag(), cached: false };\n  } catch (error) {\n    if (error instanceof SentenceAnalysisRequestError) {\n      logSentenceAnalysisDebug("request_failed", {\n        stage: error.stage, status: error.status, message: error.message, responseText: error.responseText, sentence,\n      });\n    } else if (error instanceof SentenceAnalysisFormatError) {\n      logSentenceAnalysisDebug("format_failed", { message: error.message, sentence });\n    }\n    if (error instanceof SentenceAnalysisFormatError || error instanceof SentenceAnalysisRequestError) {\n      throw new Error(t(settings.learnerLanguageCode, "errorSentenceAnalysisUnstable"));\n    }\n    throw error;\n  }\n}\n\n`,
    "analysis retry wiring",
  );

  // Local OpenAI-compatible endpoints often do not require authentication.
  text = replaceExact(
    text,
    "function shouldFallbackToGoogle(status: number, message: string): boolean {",
    `function requiresLlmApiKey(settings: TranslatorSettings): boolean {\n  if (settings.llmProvider !== "openai") return true;\n  try {\n    const hostname = new URL(settings.providerBaseUrl).hostname.toLowerCase();\n    return hostname === "api.openai.com" || hostname.endsWith(".openai.com");\n  } catch {\n    return true;\n  }\n}\n\nfunction shouldFallbackToGoogle(status: number, message: string): boolean {`,
    "local LLM auth helper",
  );

  text = replaceExact(
    text,
    `        headers: {\n          "Content-Type": "application/json",\n          Authorization: \`Bearer ${'${settings.apiKey}'}\`,\n        },`,
    `        headers: {\n          "Content-Type": "application/json",\n          ...(settings.apiKey.trim() ? { Authorization: \`Bearer ${'${settings.apiKey}'}\` } : {}),\n        },`,
    "optional OpenAI-compatible auth header",
  );

  text = text.replaceAll(
    "if (!settings.apiKey.trim()) {\n    throw new TranslatorFallbackError(\"Missing LLM API key.\");\n  }",
    "if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {\n    throw new TranslatorFallbackError(\"Missing LLM API key.\");\n  }",
  );
  text = text.replaceAll(
    "if (!settings.apiKey.trim()) {\n    throw new Error(t(settings.learnerLanguageCode, \"errorEnterApiKey\"));\n  }",
    "if (requiresLlmApiKey(settings) && !settings.apiKey.trim()) {\n    throw new Error(t(settings.learnerLanguageCode, \"errorEnterApiKey\"));\n  }",
  );

  text = replaceExact(
    text,
    "  if (!query) {\n    return undefined;\n  }",
    "  if (!query || /\\s/.test(query)) {\n    return undefined;\n  }",
    "skip phrase dictionary POS lookup",
  );

  write(path, text);
}

// ---- background ----------------------------------------------------------
{
  const path = "src/background/index.ts";
  let text = read(path);

  text = replaceExact(
    text,
    "  resolveWordFlags,\n  estimateLearnerLevel,",
    "  resolveWordFlags,\n  recordLearningExposure,\n  estimateLearnerLevel,",
    "background exposure import",
  );

  text = replaceExact(
    text,
    `  if (!flags.shouldTranslate && !forceTranslate) {\n    return {\n      lemma,\n      surface,\n      rank,\n      ...flags,\n    };\n  }\n\n  try {`,
    `  if (!flags.shouldTranslate && !forceTranslate) {\n    return {\n      lemma,\n      surface,\n      rank,\n      ...flags,\n    };\n  }\n\n  const exposureSettings = recordLearningExposure(settings, surface);\n  if (exposureSettings !== settings) {\n    await saveSettings(exposureSettings);\n  }\n\n  try {`,
    "record relearning exposure",
  );

  const preserveBlock = `  if (shouldPreserveSelectionText(text, contextText)) {\n    return {\n      text,\n      translation: text,\n      translationProvider: message.payload.provider === "llm" ? "llm" : "google-web",\n      cached: false,\n    };\n  }\n\n`;
  text = replaceExact(text, preserveBlock, "", "active selection must always translate");

  write(path, text);
}

console.log("Applied learning-engine-v2 migrations");
