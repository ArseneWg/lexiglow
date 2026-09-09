import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../src/shared/pronunciationResolver.ts", import.meta.url);
let text = await readFile(path, "utf8");

function replaceOnce(oldValue, newValue, label) {
  if (!text.includes(oldValue)) throw new Error(`Missing ${label} anchor`);
  text = text.replace(oldValue, newValue);
}

replaceOnce(
`type LocalPronunciationMap = Readonly<Record<string, readonly string[]>>;
let extendedPronunciationDataPromise: Promise<typeof import("../generated/pronunciationDataExtended")> | null = null;

function variantsFromLocalMaps(
  surface: string,
  ukMap: LocalPronunciationMap,
  usMap: LocalPronunciationMap,
  idSuffix = "",
): PronunciationVariant[] {
  const normalized = normalizeSurface(surface);
  const variants: PronunciationVariant[] = [];
  const uk = ukMap[normalized] || [];
  const us = usMap[normalized] || [];
  uk.forEach((ipa, index) => variants.push({
    id: stableVariantId("britfone" + idSuffix, normalized, "en-GB", index),
    accent: "en-GB",
    ipa: ipa.trim(),
    source: "britfone",
  }));
  us.forEach((arpabet, index) => {
    const ipa = cmuToIpa(arpabet);
    if (!ipa) return;
    variants.push({
      id: stableVariantId("cmudict" + idSuffix, normalized, "en-US", index),
      accent: "en-US",
      ipa,
      source: "cmudict",
    });
  });
  return variants;
}

async function localVariants(surface: string): Promise<PronunciationVariant[]> {
  const core = variantsFromLocalMaps(
    surface,
    LOCAL_UK_IPA as LocalPronunciationMap,
    LOCAL_US_ARPABET as LocalPronunciationMap,
  );
  const covered = new Set(core.map((variant) => variant.accent));
  if (covered.has("en-GB") && covered.has("en-US")) return core;

  extendedPronunciationDataPromise ||= import("../generated/pronunciationDataExtended");
  const extended = await extendedPronunciationDataPromise;
  return dedupeVariants([
    ...core,
    ...variantsFromLocalMaps(
      surface,
      extended.EXTENDED_LOCAL_UK_IPA as LocalPronunciationMap,
      extended.EXTENDED_LOCAL_US_ARPABET as LocalPronunciationMap,
      "-extended",
    ),
  ]);
}`,
`type LocalPronunciationMap = Readonly<Record<string, readonly string[]>>;

export interface ExtendedPronunciationData {
  us: LocalPronunciationMap;
  uk: LocalPronunciationMap;
}

const EMPTY_EXTENDED_PRONUNCIATION_DATA: ExtendedPronunciationData = { us: {}, uk: {} };
let extendedPronunciationDataPromise: Promise<ExtendedPronunciationData> | null = null;

function variantsFromLocalMaps(
  surface: string,
  ukMap: LocalPronunciationMap,
  usMap: LocalPronunciationMap,
  idSuffix = "",
): PronunciationVariant[] {
  const normalized = normalizeSurface(surface);
  const variants: PronunciationVariant[] = [];
  const uk = ukMap[normalized] || [];
  const us = usMap[normalized] || [];
  uk.forEach((ipa, index) => variants.push({
    id: stableVariantId("britfone" + idSuffix, normalized, "en-GB", index),
    accent: "en-GB",
    ipa: ipa.trim(),
    source: "britfone",
  }));
  us.forEach((arpabet, index) => {
    const ipa = cmuToIpa(arpabet);
    if (!ipa) return;
    variants.push({
      id: stableVariantId("cmudict" + idSuffix, normalized, "en-US", index),
      accent: "en-US",
      ipa,
      source: "cmudict",
    });
  });
  return variants;
}

function coreLocalVariants(surface: string): PronunciationVariant[] {
  return variantsFromLocalMaps(
    surface,
    LOCAL_UK_IPA as LocalPronunciationMap,
    LOCAL_US_ARPABET as LocalPronunciationMap,
  );
}

async function loadPackagedExtendedPronunciationData(): Promise<ExtendedPronunciationData> {
  if (extendedPronunciationDataPromise) return extendedPronunciationDataPromise;
  const runtimeApi = globalThis.chrome?.runtime;
  if (!runtimeApi?.getURL || typeof globalThis.fetch !== "function") {
    return EMPTY_EXTENDED_PRONUNCIATION_DATA;
  }

  extendedPronunciationDataPromise = (async () => {
    try {
      const response = await globalThis.fetch(
        runtimeApi.getURL("dist/pronunciationDataExtended.json"),
        { cache: "force-cache" },
      );
      if (!response.ok) return EMPTY_EXTENDED_PRONUNCIATION_DATA;
      const parsed = await response.json() as Partial<ExtendedPronunciationData>;
      return {
        us: parsed.us && typeof parsed.us === "object" ? parsed.us : {},
        uk: parsed.uk && typeof parsed.uk === "object" ? parsed.uk : {},
      };
    } catch {
      return EMPTY_EXTENDED_PRONUNCIATION_DATA;
    }
  })();
  return extendedPronunciationDataPromise;
}

async function extendedLocalVariants(
  surface: string,
  provided?: ExtendedPronunciationData,
): Promise<PronunciationVariant[]> {
  const extended = provided ?? await loadPackagedExtendedPronunciationData();
  return variantsFromLocalMaps(surface, extended.uk, extended.us, "-extended");
}`,
"local pronunciation loader",
);

replaceOnce(
`  options: { contextText?: string; partOfSpeech?: string; fetchFn?: FetchLike } = {},`,
`  options: {
    contextText?: string;
    partOfSpeech?: string;
    fetchFn?: FetchLike;
    extendedData?: ExtendedPronunciationData;
  } = {},`,
"resolver options",
);

replaceOnce(
`  const exact = dedupeVariants([...structured, ...(await localVariants(normalized))]);
  const selectedExact = selectVariantIds(exact, options.partOfSpeech);
  const missingAccents = new Set<PronunciationAccent>(
    (["en-GB", "en-US"] as const).filter((accent) => {
      const selectedId = selectedExact[accent];
      const selected = selectedId ? exact.find((variant) => variant.id === selectedId) : undefined;
      return !selected?.ipa;
    }),
  );

  const completed = [...exact];`,
`  let exact = dedupeVariants([...structured, ...coreLocalVariants(normalized)]);
  let selectedExact = selectVariantIds(exact, options.partOfSpeech);
  const needsExtendedExact = (["en-GB", "en-US"] as const).some((accent) => {
    const selectedId = selectedExact[accent];
    const selected = selectedId ? exact.find((variant) => variant.id === selectedId) : undefined;
    return !selected?.ipa;
  });
  if (needsExtendedExact) {
    exact = dedupeVariants([
      ...exact,
      ...(await extendedLocalVariants(normalized, options.extendedData)),
    ]);
    selectedExact = selectVariantIds(exact, options.partOfSpeech);
  }

  const missingAccents = new Set<PronunciationAccent>(
    (["en-GB", "en-US"] as const).filter((accent) => {
      const selectedId = selectedExact[accent];
      const selected = selectedId ? exact.find((variant) => variant.id === selectedId) : undefined;
      return !selected?.ipa;
    }),
  );

  const completed = [...exact];`,
"exact pronunciation",
);

replaceOnce(
`    for (const base of candidates) {
      let baseVariants = await localVariants(base);
      const locallyCovered = new Set(baseVariants.map((variant) => variant.accent));
      if ([...missingAccents].some((accent) => !locallyCovered.has(accent))) {
        baseVariants = dedupeVariants([
          ...baseVariants,
          ...(await lookupKaikkiVariants(base, fetchFn)),
        ]);
      }
      const derived = deriveInflectedPronunciationVariants(normalized, base, baseVariants)`,
`    for (const base of candidates) {
      let baseVariants = coreLocalVariants(base);
      let locallyCovered = new Set(
        baseVariants.filter((variant) => variant.ipa).map((variant) => variant.accent),
      );
      if ([...missingAccents].some((accent) => !locallyCovered.has(accent))) {
        baseVariants = dedupeVariants([
          ...baseVariants,
          ...(await extendedLocalVariants(base, options.extendedData)),
        ]);
        locallyCovered = new Set(
          baseVariants.filter((variant) => variant.ipa).map((variant) => variant.accent),
        );
      }
      if ([...missingAccents].some((accent) => !locallyCovered.has(accent))) {
        baseVariants = dedupeVariants([
          ...baseVariants,
          ...(await lookupKaikkiVariants(base, fetchFn)),
        ]);
      }
      const derived = deriveInflectedPronunciationVariants(normalized, base, baseVariants)`,
"base pronunciation",
);

await writeFile(path, text, "utf8");
