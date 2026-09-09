import { readFile, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

async function write(path, content) {
  await writeFile(new URL("../" + path, import.meta.url), content, "utf8");
}

async function replaceOnce(path, find, replacement) {
  const source = await read(path);
  const index = source.indexOf(find);
  if (index < 0) throw new Error(`Missing patch anchor in ${path}: ${find.slice(0, 120)}`);
  const next = source.slice(0, index) + replacement + source.slice(index + find.length);
  await write(path, next);
}

async function appendOnce(path, marker, addition) {
  const source = await read(path);
  if (source.includes(marker)) return;
  await write(path, source.trimEnd() + "\n\n" + addition.trim() + "\n");
}

// Runtime message for async structured lexical metadata on the fast Google path.
await replaceOnce(
  "src/shared/messages.ts",
  `export interface SetWordMasteredMessage {`,
  `export interface LookupLexicalMetadataMessage {\n  type: "LOOKUP_LEXICAL_METADATA";\n  payload: {\n    surface: string;\n    contextText?: string;\n    partOfSpeech?: string;\n    primaryTranslation?: string;\n  };\n}\n\nexport interface SetWordMasteredMessage {`,
);
await replaceOnce(
  "src/shared/messages.ts",
  `  | LookupWordMessage\n  | SetWordMasteredMessage`,
  `  | LookupWordMessage\n  | LookupLexicalMetadataMessage\n  | SetWordMasteredMessage`,
);
await replaceOnce(
  "src/shared/messages.ts",
  `export interface SettingsResponse {`,
  `export interface LexicalMetadataResponse {\n  ok: boolean;\n  result?: Pick<LexiconLookupResult,\n    "lexicalLemma" | "wordFormLabel" | "contextualPartOfSpeech" | "semanticHint" | "alternativeMeanings"\n  >;\n  error?: string;\n}\n\nexport interface SettingsResponse {`,
);

// Structured dictionary metadata usable without invoking an LLM.
await replaceOnce(
  "src/shared/lexicalSense.ts",
  `import type { SupportedLearnerLanguageCode } from "./types";`,
  `import type { AlternativeMeaning, SupportedLearnerLanguageCode } from "./types";`,
);
await appendOnce(
  "src/shared/lexicalSense.ts",
  "export function buildStructuredLexicalMetadata",
  `function compactGloss(value: string, limit = 118): string | undefined {\n  const compact = value.replace(/\\s+/g, " ").trim();\n  if (!compact) return undefined;\n  return compact.length <= limit ? compact : compact.slice(0, limit - 1).trimEnd() + "…";\n}\n\nexport function buildStructuredLexicalMetadata(\n  lookup: StructuredLexicalLookup,\n  primaryTranslation = "",\n): {\n  lexicalLemma?: string;\n  wordFormLabel?: string;\n  contextualPartOfSpeech?: string;\n  semanticHint?: string;\n  alternativeMeanings?: AlternativeMeaning[];\n} {\n  const primarySense = lookup.senses[0];\n  const normalizedPrimary = primaryTranslation.trim().toLocaleLowerCase();\n  const seen = new Set<string>(normalizedPrimary ? [normalizedPrimary] : []);\n  const alternativeMeanings: AlternativeMeaning[] = [];\n\n  for (const sense of lookup.senses) {\n    for (const meaning of sense.targetMeanings || []) {\n      const normalized = meaning.trim().toLocaleLowerCase();\n      if (!normalized || seen.has(normalized)) continue;\n      seen.add(normalized);\n      alternativeMeanings.push({\n        meaning,\n        partOfSpeech: sense.partOfSpeech,\n        semanticHint: compactGloss(sense.gloss, 82),\n      });\n      if (alternativeMeanings.length >= 3) break;\n    }\n    if (alternativeMeanings.length >= 3) break;\n  }\n\n  return {\n    lexicalLemma: lookup.lemma || undefined,\n    wordFormLabel: lookup.wordFormLabel,\n    contextualPartOfSpeech: primarySense?.partOfSpeech,\n    semanticHint: primarySense ? compactGloss(primarySense.gloss) : undefined,\n    alternativeMeanings: alternativeMeanings.length ? alternativeMeanings : undefined,\n  };\n}`,
);

// Background handler + cache for asynchronous metadata enrichment.
await replaceOnce(
  "src/background/index.ts",
  `  LookupPronunciationMessage,\n  LookupWordMessage,`,
  `  LookupPronunciationMessage,\n  LookupLexicalMetadataMessage,\n  LookupWordMessage,`,
);
await replaceOnce(
  "src/background/index.ts",
  `import { describeEnglishWordForm } from "../shared/lexicalSense";`,
  `import {\n  buildStructuredLexicalMetadata,\n  describeEnglishWordForm,\n  lookupStructuredLexicalSenses,\n} from "../shared/lexicalSense";`,
);
await replaceOnce(
  "src/background/index.ts",
  `const sentenceAnalysisCache = createMemoryCache<SentenceAnalysisCacheEntry>();`,
  `const sentenceAnalysisCache = createMemoryCache<SentenceAnalysisCacheEntry>();\nconst lexicalMetadataCache = createMemoryCache<Pick<LexiconLookupResult,\n  "lexicalLemma" | "wordFormLabel" | "contextualPartOfSpeech" | "semanticHint" | "alternativeMeanings"\n>>();`,
);
await replaceOnce(
  "src/background/index.ts",
  `  sentenceAnalysisCache.clear();\n}`,
  `  sentenceAnalysisCache.clear();\n  lexicalMetadataCache.clear();\n}`,
);
await replaceOnce(
  "src/background/index.ts",
  `async function handleLookup(message: LookupWordMessage): Promise<LexiconLookupResult> {`,
  `async function handleLookupLexicalMetadata(message: LookupLexicalMetadataMessage) {\n  const surface = message.payload.surface.trim();\n  const contextText = message.payload.contextText?.trim() ?? "";\n  const partOfSpeech = message.payload.partOfSpeech?.trim() || undefined;\n  const translatorSettings = await getTranslatorSettings();\n  const cacheKey = [\n    translatorSettings.learnerLanguageCode,\n    surface.toLowerCase(),\n    partOfSpeech || "",\n    contextText,\n  ].join("::");\n  const cached = lexicalMetadataCache.get(cacheKey);\n  if (cached) return cached;\n\n  const lookup = await lookupStructuredLexicalSenses(surface, {\n    contextText,\n    partOfSpeech,\n    learnerLanguageCode: translatorSettings.learnerLanguageCode,\n  });\n  const result = buildStructuredLexicalMetadata(lookup, message.payload.primaryTranslation || "");\n  lexicalMetadataCache.set(cacheKey, result, 6 * 60 * 60 * 1000);\n  return result;\n}\n\nasync function handleLookup(message: LookupWordMessage): Promise<LexiconLookupResult> {`,
);
await replaceOnce(
  "src/background/index.ts",
  `      case "LOOKUP_WORD":\n        sendResponse({ ok: true, result: await handleLookup(message) });\n        break;\n      case "TRANSLATE_WORD":`,
  `      case "LOOKUP_WORD":\n        sendResponse({ ok: true, result: await handleLookup(message) });\n        break;\n      case "LOOKUP_LEXICAL_METADATA":\n        sendResponse({ ok: true, result: await handleLookupLexicalMetadata(message) });\n        break;\n      case "TRANSLATE_WORD":`,
);

// Content-script enrichment arrives after the fast Google translation is already visible.
await replaceOnce(
  "src/content/index.ts",
  `  LookupWordResponse,\n  PronunciationLookupResponse,`,
  `  LookupWordResponse,\n  LexicalMetadataResponse,\n  PronunciationLookupResponse,`,
);
await replaceOnce(
  "src/content/index.ts",
  `let activeSelectionTranslationRequestId = 0;`,
  `let activeSelectionTranslationRequestId = 0;\nlet activeLexicalMetadataRequestId = 0;`,
);
await replaceOnce(
  "src/content/index.ts",
  `  activeSelectionTranslationRequestId += 1;\n  activePronunciationRequestId += 1;`,
  `  activeSelectionTranslationRequestId += 1;\n  activeLexicalMetadataRequestId += 1;\n  activePronunciationRequestId += 1;`,
);
await replaceOnce(
  "src/content/index.ts",
  `  activeSelectionTranslationRequestId += 1;\n  activeSentenceAnalysisRequestId += 1;`,
  `  activeSelectionTranslationRequestId += 1;\n  activeLexicalMetadataRequestId += 1;\n  activeSentenceAnalysisRequestId += 1;`,
);
await replaceOnce(
  "src/content/index.ts",
  `function isLlmTranslationProvider(provider?: string) {`,
  `async function loadLexicalMetadata(\n  surface: string,\n  contextText: string,\n  partOfSpeech?: string,\n  primaryTranslation?: string,\n) {\n  const normalizedSurface = normalizeSingleEnglishWord(surface) || surface.trim();\n  if (!normalizedSurface) return;\n  activeLexicalMetadataRequestId += 1;\n  const requestId = activeLexicalMetadataRequestId;\n\n  let response: LexicalMetadataResponse;\n  try {\n    response = await runtimeSend<LexicalMetadataResponse>({\n      type: "LOOKUP_LEXICAL_METADATA",\n      payload: { surface: normalizedSurface, contextText, partOfSpeech, primaryTranslation },\n    });\n  } catch (error) {\n    if (isExtensionContextInvalidated(error)) hideTooltip();\n    return;\n  }\n\n  if (!response.ok || !response.result || requestId !== activeLexicalMetadataRequestId) return;\n  const visibleSurface = activeResult?.surface || (\n    activeSelectionTooltipContext && isSingleEnglishWord(activeSelectionTooltipContext.text)\n      ? normalizeSingleEnglishWord(activeSelectionTooltipContext.text)\n      : ""\n  );\n  if (!visibleSurface || visibleSurface.toLowerCase() !== normalizedSurface.toLowerCase()) return;\n\n  const metadata = response.result;\n  renderLexicalMeaningDisplay({\n    lemma: activeResult?.lemma || normalizedSurface,\n    lexicalLemma: metadata.lexicalLemma,\n    wordFormLabel: metadata.wordFormLabel,\n    semanticHint: metadata.semanticHint,\n    alternativeMeanings: metadata.alternativeMeanings,\n  });\n  const pos = metadata.contextualPartOfSpeech || partOfSpeech || "";\n  if (pos) {\n    tooltip.primaryTranslationPosEl.textContent = pos;\n    tooltip.primaryTranslationPosEl.dataset.visible = "true";\n    if (tooltip.wordView.dataset.layout === "word") {\n      tooltip.surfacePosEl.textContent = pos;\n      tooltip.surfacePosEl.dataset.visible = "true";\n    }\n  }\n  if (activeResult) {\n    activeResult = {\n      ...activeResult,\n      lexicalLemma: metadata.lexicalLemma || activeResult.lexicalLemma,\n      wordFormLabel: metadata.wordFormLabel || activeResult.wordFormLabel,\n      contextualPartOfSpeech: metadata.contextualPartOfSpeech || activeResult.contextualPartOfSpeech,\n      semanticHint: metadata.semanticHint || activeResult.semanticHint,\n      alternativeMeanings: metadata.alternativeMeanings || activeResult.alternativeMeanings,\n    };\n  }\n  if (activeAnchorRect) positionTooltip(activeAnchorRect);\n}\n\nfunction isLlmTranslationProvider(provider?: string) {`,
);
await replaceOnce(
  "src/content/index.ts",
  `  const pos = isLlmTranslationProvider(provider) ? contextualPartOfSpeech ?? "" : "";`,
  `  const pos = contextualPartOfSpeech ?? "";`,
);
await replaceOnce(
  "src/content/index.ts",
  `    result.contextualPartOfSpeech,\n    result.translationProvider,`,
  `    result.contextualPartOfSpeech || result.partOfSpeech,\n    result.translationProvider,`,
);
await replaceOnce(
  "src/content/index.ts",
  `  const requestContext = activeContext;\n  setDisplayedTranslationProvider(provider);`,
  `  const requestContext = activeContext;\n  if (provider === "llm") activeLexicalMetadataRequestId += 1;\n  setDisplayedTranslationProvider(provider);`,
);
await replaceOnce(
  "src/content/index.ts",
  `  activeResult = result;\n  await animateTranslationSwap(() => {\n    renderTooltip(result, requestContext.rect);\n  });\n}`,
  `  activeResult = result;\n  await animateTranslationSwap(() => {\n    renderTooltip(result, requestContext.rect);\n  });\n  if (normalizeDisplayedTranslationProvider(result.translationProvider) === "google") {\n    void loadLexicalMetadata(\n      result.surface,\n      requestContext.contextText,\n      result.partOfSpeech,\n      result.translation,\n    );\n  }\n}`,
);
await replaceOnce(
  "src/content/index.ts",
  `  activeSelectionTooltipContext = context;\n  setDisplayedTranslationProvider(provider);`,
  `  activeSelectionTooltipContext = context;\n  if (provider === "llm") activeLexicalMetadataRequestId += 1;\n  setDisplayedTranslationProvider(provider);`,
);
await replaceOnce(
  "src/content/index.ts",
  `  await animateTranslationSwap(() => {\n    renderSelectionTooltip(context, result || undefined);\n  });\n}`,
  `  await animateTranslationSwap(() => {\n    renderSelectionTooltip(context, result || undefined);\n  });\n  if (\n    result &&\n    isSingleEnglishWord(context.text) &&\n    normalizeDisplayedTranslationProvider(result.translationProvider) === "google"\n  ) {\n    void loadLexicalMetadata(context.text, context.contextText, undefined, result.translation);\n  }\n}`,
);

// Pronunciation: lazy-load the 5k-10k tier, prefer IPA for display, but preserve exact human audio separately.
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `function localVariants(surface: string): PronunciationVariant[] {\n  const normalized = normalizeSurface(surface);\n  const variants: PronunciationVariant[] = [];\n  const uk = (LOCAL_UK_IPA as Readonly<Record<string, readonly string[]>>)[normalized] || [];\n  const us = (LOCAL_US_ARPABET as Readonly<Record<string, readonly string[]>>)[normalized] || [];\n  uk.forEach((ipa, index) => variants.push({\n    id: stableVariantId("britfone", normalized, "en-GB", index),\n    accent: "en-GB",\n    ipa: ipa.trim(),\n    source: "britfone",\n  }));\n  us.forEach((arpabet, index) => {\n    const ipa = cmuToIpa(arpabet);\n    if (!ipa) return;\n    variants.push({\n      id: stableVariantId("cmudict", normalized, "en-US", index),\n      accent: "en-US",\n      ipa,\n      source: "cmudict",\n    });\n  });\n  return variants;\n}`,
  `type LocalPronunciationMap = Readonly<Record<string, readonly string[]>>;\nlet extendedPronunciationDataPromise: Promise<typeof import("../generated/pronunciationDataExtended")> | null = null;\n\nfunction variantsFromLocalMaps(\n  surface: string,\n  ukMap: LocalPronunciationMap,\n  usMap: LocalPronunciationMap,\n  idSuffix = "",\n): PronunciationVariant[] {\n  const normalized = normalizeSurface(surface);\n  const variants: PronunciationVariant[] = [];\n  const uk = ukMap[normalized] || [];\n  const us = usMap[normalized] || [];\n  uk.forEach((ipa, index) => variants.push({\n    id: stableVariantId("britfone" + idSuffix, normalized, "en-GB", index),\n    accent: "en-GB",\n    ipa: ipa.trim(),\n    source: "britfone",\n  }));\n  us.forEach((arpabet, index) => {\n    const ipa = cmuToIpa(arpabet);\n    if (!ipa) return;\n    variants.push({\n      id: stableVariantId("cmudict" + idSuffix, normalized, "en-US", index),\n      accent: "en-US",\n      ipa,\n      source: "cmudict",\n    });\n  });\n  return variants;\n}\n\nasync function localVariants(surface: string): Promise<PronunciationVariant[]> {\n  const core = variantsFromLocalMaps(\n    surface,\n    LOCAL_UK_IPA as LocalPronunciationMap,\n    LOCAL_US_ARPABET as LocalPronunciationMap,\n  );\n  const covered = new Set(core.map((variant) => variant.accent));\n  if (covered.has("en-GB") && covered.has("en-US")) return core;\n\n  extendedPronunciationDataPromise ||= import("../generated/pronunciationDataExtended");\n  const extended = await extendedPronunciationDataPromise;\n  return dedupeVariants([\n    ...core,\n    ...variantsFromLocalMaps(\n      surface,\n      extended.EXTENDED_LOCAL_UK_IPA as LocalPronunciationMap,\n      extended.EXTENDED_LOCAL_US_ARPABET as LocalPronunciationMap,\n      "-extended",\n    ),\n  ]);\n}`,
);
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `  if (variant.audio?.url && variant.ipa) score += 80;\n  else if (variant.audio?.url) score += 55;\n  else if (variant.ipa) score += 35;`,
  `  if (variant.audio?.url && variant.ipa) score += 90;\n  else if (variant.ipa) score += 65;\n  else if (variant.audio?.url) score += 35;`,
);
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `function buildResult(surface: string, variants: PronunciationVariant[], confidence: PronunciationConfidence, ttsAllowed: boolean, partOfSpeech?: string): Omit<PronunciationResult, "cached"> {\n  const deduped = dedupeVariants(variants);\n  const selectedVariantIds = confidence === "ambiguous" ? {} : selectVariantIds(deduped, partOfSpeech);\n  const uk = selectedVariantIds["en-GB"] ? deduped.find((item) => item.id === selectedVariantIds["en-GB"]) : undefined;\n  const us = selectedVariantIds["en-US"] ? deduped.find((item) => item.id === selectedVariantIds["en-US"]) : undefined;`,
  `function buildResult(surface: string, variants: PronunciationVariant[], confidence: PronunciationConfidence, ttsAllowed: boolean, partOfSpeech?: string): Omit<PronunciationResult, "cached"> {\n  const deduped = dedupeVariants(variants);\n  const selectedVariantIds = confidence === "ambiguous" ? {} : selectVariantIds(deduped, partOfSpeech);\n  const uk = selectedVariantIds["en-GB"] ? deduped.find((item) => item.id === selectedVariantIds["en-GB"]) : undefined;\n  const us = selectedVariantIds["en-US"] ? deduped.find((item) => item.id === selectedVariantIds["en-US"]) : undefined;\n  const ukAudio = chooseVariant(deduped.filter((item) => item.audio?.url), "en-GB", partOfSpeech);\n  const usAudio = chooseVariant(deduped.filter((item) => item.audio?.url), "en-US", partOfSpeech);`,
);
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `    ukAudioUrl: uk?.audio?.url,\n    usAudioUrl: us?.audio?.url,`,
  `    ukAudioUrl: uk?.audio?.url ?? ukAudio?.audio?.url,\n    usAudioUrl: us?.audio?.url ?? usAudio?.audio?.url,`,
);
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `  const exact = dedupeVariants([...structured, ...localVariants(normalized)]);\n  const selectedExact = selectVariantIds(exact, options.partOfSpeech);\n  const missingAccents = new Set<PronunciationAccent>(\n    (["en-GB", "en-US"] as const).filter((accent) => !selectedExact[accent]),\n  );`,
  `  const exact = dedupeVariants([...structured, ...(await localVariants(normalized))]);\n  const selectedExact = selectVariantIds(exact, options.partOfSpeech);\n  const missingAccents = new Set<PronunciationAccent>(\n    (["en-GB", "en-US"] as const).filter((accent) => {\n      const selectedId = selectedExact[accent];\n      const selected = selectedId ? exact.find((variant) => variant.id === selectedId) : undefined;\n      return !selected?.ipa;\n    }),\n  );`,
);
await replaceOnce(
  "src/shared/pronunciationResolver.ts",
  `      let baseVariants = localVariants(base);`,
  `      let baseVariants = await localVariants(base);`,
);

// Deterministic regression coverage for the exact screenshots.
await appendOnce(
  "tests/pronunciationResolver.test.ts",
  `resolves predictions from the lazy extended offline tier`,
  `test("resolves predictions from the lazy extended offline tier when the network is unavailable", async () => {\n  const result = await resolvePronunciation("predictions", { fetchFn: failedFetch() as never });\n  expect(result.ukPhonetic).toBeTruthy();\n  expect(result.usPhonetic).toBeTruthy();\n  expect(result.ukPhonetic).not.toBe("No IPA");\n  expect(result.usPhonetic).not.toBe("No IPA");\n});\n\ntest("uses exact audio while filling an audio-only accent with IPA", async () => {\n  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {\n    const url = String(input);\n    if (url.endsWith("/measuring.jsonl")) {\n      return { ok: true, text: async () => JSON.stringify({\n        word: "measuring",\n        pos: "verb",\n        sounds: [\n          { tags: ["UK"], ipa: "/ˈmɛʒərɪŋ/" },\n          { tags: ["US"], mp3_url: "https://audio.test/measuring-us.mp3" },\n        ],\n      }) };\n    }\n    return { ok: false, text: async () => "" };\n  });\n  const result = await resolvePronunciation("measuring", { partOfSpeech: "verb", fetchFn: fetchMock as never });\n  expect(result.ukPhonetic).toBeTruthy();\n  expect(result.usPhonetic).toBeTruthy();\n  expect(result.usAudioUrl).toBe("https://audio.test/measuring-us.mp3");\n});`,
);

await appendOnce(
  "e2e/pronunciation-accuracy.spec.ts",
  `predictions keeps IPA offline when Kaikki is unavailable`,
  `test("predictions keeps UK/US IPA offline when Kaikki is unavailable", async ({ context, page }) => {\n  await mockGoogleTranslation(context, "预测");\n  await context.route("https://kaikki.org/dictionary/English/meaning/**", (route) =>\n    route.fulfill({ status: 503, body: "" }),\n  );\n  await serveTestPage(context, page, '<p>The model emits several <span id="target">predictions</span>.</p>');\n  await selectElementText(page, "#target");\n  await expect(page.locator(".wordwise-pronunciation")).toBeVisible();\n  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA", { timeout: 4_000 });\n});\n\ntest("Measuring keeps exact audio but fills the missing IPA", async ({ context, page }) => {\n  await mockGoogleTranslation(context, "测量");\n  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {\n    const url = route.request().url();\n    if (url.endsWith("/measuring.jsonl")) {\n      await route.fulfill({\n        status: 200,\n        contentType: "application/jsonl",\n        body: JSON.stringify({ word: "measuring", pos: "verb", sounds: [\n          { tags: ["UK"], ipa: "/ˈmɛʒərɪŋ/" },\n          { tags: ["US"], mp3_url: "https://audio.test/measuring-us.wav" },\n        ] }),\n      });\n      return;\n    }\n    await route.fulfill({ status: 404, body: "" });\n  });\n  await serveTestPage(context, page, '<p><span id="target">Measuring</span> token prediction differences is useful.</p>');\n  await selectElementText(page, "#target");\n  await expect(page.locator(".wordwise-pronunciation")).toBeVisible();\n  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("Audio only", { timeout: 4_000 });\n  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA");\n});`,
);

await appendOnce(
  "tests/lexicalSense.test.ts",
  `builds visible metadata for the fast translation path`,
  `test("builds visible metadata for the fast translation path", async () => {\n  const { buildStructuredLexicalMetadata } = await import("../src/shared/lexicalSense");\n  const metadata = buildStructuredLexicalMetadata({\n    surface: "predictions",\n    lemma: "prediction",\n    wordFormLabel: "plural",\n    senses: [\n      { partOfSpeech: "noun", gloss: "A statement about what will happen in the future.", targetMeanings: ["预测", "预言"], source: "kaikki" },\n      { partOfSpeech: "noun", gloss: "A forecast produced by a model.", targetMeanings: ["预测结果"], source: "kaikki" },\n    ],\n  }, "预测");\n  expect(metadata.lexicalLemma).toBe("prediction");\n  expect(metadata.wordFormLabel).toBe("plural");\n  expect(metadata.semanticHint).toContain("statement");\n  expect(metadata.alternativeMeanings?.map((item) => item.meaning)).toEqual(["预言", "预测结果"]);\n});`,
);

// Real public page that contains the two words reported in the installed-extension screenshots.
await write(
  "e2e/sites/default-lexical-ux-sites.spec.ts",
  `import type { Page } from "@playwright/test";\n\nimport { expect, test } from "../fixtures";\nimport { clearExtensionStorage, mockGoogleTranslation, seedUserSettings } from "../helpers";\n\nasync function selectWord(page: Page, word: string): Promise<boolean> {\n  return page.evaluate((target) => {\n    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);\n    const pattern = new RegExp("\\\\b" + target + "\\\\b", "i");\n    let node = walker.nextNode() as Text | null;\n    while (node) {\n      const parent = node.parentElement;\n      const match = parent && !parent.closest("script, style, noscript, code, pre")\n        ? (node.textContent || "").match(pattern)\n        : null;\n      if (match && match.index !== undefined && parent) {\n        const style = getComputedStyle(parent);\n        const parentRect = parent.getBoundingClientRect();\n        if (style.display === "none" || style.visibility === "hidden" || parentRect.width <= 0 || parentRect.height <= 0) {\n          node = walker.nextNode() as Text | null;\n          continue;\n        }\n        parent.scrollIntoView({ block: "center" });\n        const range = document.createRange();\n        range.setStart(node, match.index);\n        range.setEnd(node, match.index + match[0].length);\n        const selection = window.getSelection();\n        selection?.removeAllRanges();\n        selection?.addRange(range);\n        document.dispatchEvent(new Event("selectionchange"));\n        const rect = range.getBoundingClientRect();\n        parent.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 }));\n        return true;\n      }\n      node = walker.nextNode() as Text | null;\n    }\n    return false;\n  }, word);\n}\n\ntest.beforeEach(async ({ context, extensionWorker }) => {\n  await clearExtensionStorage(extensionWorker);\n  await seedUserSettings(extensionWorker, { knownBaseRank: 0 });\n  await mockGoogleTranslation(context, "预测");\n});\n\ntest("web.dev default Google card visibly enriches predictions and keeps offline IPA", async ({ context, page }) => {\n  await context.route("https://kaikki.org/dictionary/English/meaning/**", async (route) => {\n    const url = route.request().url();\n    if (url.endsWith("/predictions.jsonl")) {\n      await route.fulfill({ status: 200, contentType: "application/jsonl", body: JSON.stringify({\n        word: "predictions", pos: "noun", senses: [{ tags: ["form-of"], form_of: [{ word: "prediction" }], glosses: ["plural of prediction"] }],\n      }) });\n      return;\n    }\n    if (url.endsWith("/prediction.jsonl")) {\n      await route.fulfill({ status: 200, contentType: "application/jsonl", body: JSON.stringify({\n        word: "prediction", pos: "noun", senses: [\n          { glosses: ["A statement about what will happen in the future."], translations: [{ lang_code: "cmn", word: "预测" }, { lang_code: "cmn", word: "预言" }] },\n          { glosses: ["A forecast produced by a statistical or machine-learning model."], translations: [{ lang_code: "cmn", word: "预测结果" }] },\n        ],\n      }) });\n      return;\n    }\n    await route.fulfill({ status: 503, body: "" });\n  });\n  const response = await page.goto("https://web.dev/articles/prerender-pages", { waitUntil: "domcontentloaded", timeout: 30_000 });\n  expect(response?.status() ?? 200).toBeLessThan(400);\n  await page.waitForTimeout(600);\n  expect(await selectWord(page, "predictions")).toBe(true);\n  await expect(page.locator(".wordwise-primary-translation")).toContainText("预测");\n  await expect(page.locator(".wordwise-word-form")).toContainText("prediction · plural", { timeout: 5_000 });\n  await expect(page.locator(".wordwise-semantic-hint")).toContainText("statement", { timeout: 5_000 });\n  await expect(page.locator(".wordwise-other-meanings")).toBeVisible();\n  await expect(page.locator(".wordwise-pronunciation")).not.toContainText("No IPA", { timeout: 5_000 });\n});\n`,
);

console.log("Applied default lexical UX and pronunciation hotfix.");
