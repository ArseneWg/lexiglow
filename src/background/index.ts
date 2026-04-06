import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type {
  AnalyzeSelectionMessage,
  GetSettingsMessage,
  GetTranslatorSettingsMessage,
  LookupWordMessage,
  RemoveWordIgnoredMessage,
  RuntimeMessage,
  SaveTranslatorSettingsMessage,
  SelectionTranslationResponse,
  SetWordIgnoredMessage,
  SetWordMasteredMessage,
  SetWordUnmasteredMessage,
  TranslateWordMessage,
  TranslationProviderChoice,
  UpdateBaseRankMessage,
} from "../shared/messages";
import {
  removeWordIgnored,
  resolveWordFlags,
  setWordIgnored,
  setWordMastered,
  setWordUnmastered,
  updateKnownBaseRank,
} from "../shared/settings";
import {
  getCachedSelectionTranslation,
  getCachedTranslation,
  getSettings,
  getTranslatorSettings,
  saveSettings,
  saveTranslatorSettings,
  setCachedSelectionTranslation,
  setCachedTranslation,
} from "../shared/storage";
import {
  analyzeSentenceWithLlm,
  isTranslatorFallbackError,
  translateWithGoogle,
  translateWithLlm,
} from "../shared/translator";
import type {
  CacheEntry,
  LexiconLookupResult,
  SentenceAnalysisResult,
  TranslationResult,
} from "../shared/types";

const inFlightTranslations = new Map<string, Promise<TranslationResult>>();

async function translateByChoice({
  provider,
  lemma,
  surface,
  contextText,
}: {
  provider: TranslationProviderChoice;
  lemma: string;
  surface: string;
  contextText: string;
}): Promise<TranslationResult> {
  if (provider === "google") {
    return translateWithGoogle({ lemma, surface });
  }

  const translatorSettings = await getTranslatorSettings();

  try {
    return await translateWithLlm({
      surface,
      contextText,
      settings: translatorSettings,
    });
  } catch (error) {
    if (!translatorSettings.fallbackToGoogle || !isTranslatorFallbackError(error)) {
      throw error;
    }

    return translateWithGoogle({ lemma, surface });
  }
}

async function getOrTranslate(
  lemma: string,
  surface: string,
  contextText: string,
  provider: TranslationProviderChoice,
): Promise<CacheEntry | TranslationResult> {
  const requestKey = `${provider}::${lemma}::${contextText}`;
  const cached = await getCachedTranslation(lemma, contextText, provider);

  if (cached?.translation) {
    return {
      translation: cached.translation,
      sentenceTranslation: cached.sentenceTranslation,
      provider: cached.provider,
      cached: true,
    };
  }

  let pending = inFlightTranslations.get(requestKey);

  if (!pending) {
    pending = translateByChoice({ provider, lemma, surface, contextText });
    inFlightTranslations.set(requestKey, pending);
  }

  try {
    const result = await pending;
    await setCachedTranslation(lemma, contextText, provider, {
      translation: result.translation,
      sentenceTranslation: result.sentenceTranslation,
      provider: result.provider,
      updatedAt: Date.now(),
    });
    return result;
  } finally {
    inFlightTranslations.delete(requestKey);
  }
}

async function getOrTranslateSelection(
  text: string,
  contextText: string,
  provider: TranslationProviderChoice,
): Promise<CacheEntry | TranslationResult> {
  const requestKey = `selection::${provider}::${text}::${contextText}`;
  const cached = await getCachedSelectionTranslation(text, contextText, provider);

  if (cached?.translation) {
    return {
      translation: cached.translation,
      sentenceTranslation: cached.sentenceTranslation,
      provider: cached.provider,
      cached: true,
    };
  }

  let pending = inFlightTranslations.get(requestKey);

  if (!pending) {
    pending = translateByChoice({
      provider,
      lemma: text,
      surface: text,
      contextText,
    });
    inFlightTranslations.set(requestKey, pending);
  }

  try {
    const result = await pending;
    await setCachedSelectionTranslation(text, contextText, provider, {
      translation: result.translation,
      sentenceTranslation: result.sentenceTranslation,
      provider: result.provider,
      updatedAt: Date.now(),
    });
    return result;
  } finally {
    inFlightTranslations.delete(requestKey);
  }
}

async function handleLookup(message: LookupWordMessage): Promise<LexiconLookupResult> {
  const surface = message.payload.surface;
  const lemma = resolveLookupLemma(surface);
  const settings = await getSettings();
  const rank = lemma ? lookupRank(lemma) : null;
  const flags = resolveWordFlags(lemma, rank, settings, surface);

  if (!lemma) {
    return {
      lemma,
      surface,
      rank,
      ...flags,
    };
  }

  return {
    lemma,
    surface,
    rank,
    ...flags,
  };
}

async function handleTranslateWord(message: TranslateWordMessage): Promise<LexiconLookupResult> {
  const surface = message.payload.surface;
  const forceTranslate = Boolean(message.payload.forceTranslate);
  const contextText = message.payload.contextText?.trim() ?? "";
  const provider = message.payload.provider;
  const lemma = resolveLookupLemma(surface);
  const settings = await getSettings();
  const rank = lemma ? lookupRank(lemma) : null;
  const flags = resolveWordFlags(lemma, rank, settings, surface);

  if (!lemma) {
    return {
      lemma,
      surface,
      rank,
      ...flags,
    };
  }

  if (!flags.shouldTranslate && !forceTranslate) {
    return {
      lemma,
      surface,
      rank,
      ...flags,
    };
  }

  try {
    const translation = await getOrTranslate(lemma, surface, contextText, provider);

    return {
      lemma,
      surface,
      rank,
      ...flags,
      isIgnored: false,
      isKnown: false,
      shouldTranslate: true,
      reason: "translate",
      translation: translation.translation,
      sentenceTranslation: translation.sentenceTranslation,
      translationProvider: translation.provider,
      cached: translation.cached,
    };
  } catch {
    return {
      lemma,
      surface,
      rank,
      ...flags,
      isIgnored: false,
      isKnown: false,
      shouldTranslate: true,
      reason: "translate",
      translation: "暂不可用",
      sentenceTranslation: undefined,
      translationProvider: provider === "llm" ? "deepseek-chat" : "google-web",
      cached: false,
    };
  }
}

async function handleAnalyzeSelection(
  message: AnalyzeSelectionMessage,
): Promise<SentenceAnalysisResult> {
  const text = message.payload.text.trim();
  const translatorSettings = await getTranslatorSettings();

  return analyzeSentenceWithLlm({
    text,
    settings: translatorSettings,
  });
}

async function handleTranslateSelection(
  message: Extract<RuntimeMessage, { type: "TRANSLATE_SELECTION" }>,
): Promise<SelectionTranslationResponse["result"]> {
  const text = message.payload.text.trim();
  const contextText = message.payload.contextText?.trim() ?? text;

  if (!text) {
    return {
      text,
      translation: "暂不可用",
      translationProvider: message.payload.provider === "llm" ? "deepseek-chat" : "google-web",
      cached: false,
    };
  }

  try {
    const translation = await getOrTranslateSelection(text, contextText, message.payload.provider);

    return {
      text,
      translation: translation.translation,
      sentenceTranslation: translation.sentenceTranslation,
      translationProvider: translation.provider,
      cached: translation.cached,
    };
  } catch {
    return {
      text,
      translation: "暂不可用",
      translationProvider: message.payload.provider === "llm" ? "deepseek-chat" : "google-web",
      cached: false,
    };
  }
}

async function handleSetMastered(message: SetWordMasteredMessage) {
  const settings = await getSettings();
  const next = setWordMastered(settings, message.payload.lemma);
  await saveSettings(next);
  return { ok: true, settings: next };
}

async function handleSetUnmastered(message: SetWordUnmasteredMessage) {
  const settings = await getSettings();
  const next = setWordUnmastered(settings, message.payload.lemma, message.payload.rank);
  await saveSettings(next);
  return { ok: true, settings: next };
}

async function handleSetIgnored(message: SetWordIgnoredMessage) {
  const settings = await getSettings();
  const next = setWordIgnored(settings, message.payload.lemma);
  await saveSettings(next);
  return { ok: true, settings: next };
}

async function handleRemoveIgnored(message: RemoveWordIgnoredMessage) {
  const settings = await getSettings();
  const next = removeWordIgnored(settings, message.payload.lemma);
  await saveSettings(next);
  return { ok: true, settings: next };
}

async function handleUpdateBaseRank(message: UpdateBaseRankMessage) {
  const settings = await getSettings();
  const next = updateKnownBaseRank(settings, message.payload.knownBaseRank);
  await saveSettings(next);
  return { ok: true, settings: next };
}

async function handleGetSettings(_message: GetSettingsMessage) {
  const settings = await getSettings();
  return { ok: true, settings };
}

async function handleGetTranslatorSettings(_message: GetTranslatorSettingsMessage) {
  const settings = await getTranslatorSettings();
  return { ok: true, settings };
}

async function handleSaveTranslatorSettings(message: SaveTranslatorSettingsMessage) {
  await saveTranslatorSettings(message.payload.settings);
  const settings = await getTranslatorSettings();
  return { ok: true, settings };
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "LOOKUP_WORD":
        sendResponse({ ok: true, result: await handleLookup(message) });
        break;
      case "TRANSLATE_WORD":
        sendResponse({ ok: true, result: await handleTranslateWord(message) });
        break;
      case "ANALYZE_SELECTION":
        sendResponse({ ok: true, result: await handleAnalyzeSelection(message) });
        break;
      case "TRANSLATE_SELECTION":
        sendResponse({ ok: true, result: await handleTranslateSelection(message) });
        break;
      case "SET_WORD_MASTERED":
        sendResponse(await handleSetMastered(message));
        break;
      case "SET_WORD_UNMASTERED":
        sendResponse(await handleSetUnmastered(message));
        break;
      case "SET_WORD_IGNORED":
        sendResponse(await handleSetIgnored(message));
        break;
      case "REMOVE_WORD_IGNORED":
        sendResponse(await handleRemoveIgnored(message));
        break;
      case "UPDATE_BASE_RANK":
        sendResponse(await handleUpdateBaseRank(message));
        break;
      case "GET_SETTINGS":
        sendResponse(await handleGetSettings(message));
        break;
      case "GET_TRANSLATOR_SETTINGS":
        sendResponse(await handleGetTranslatorSettings(message));
        break;
      case "SAVE_TRANSLATOR_SETTINGS":
        sendResponse(await handleSaveTranslatorSettings(message));
        break;
      default:
        sendResponse({ ok: false, error: "Unknown message type." });
    }
  })().catch((error: unknown) => {
    const messageText = error instanceof Error ? error.message : "Unexpected runtime error.";
    sendResponse({ ok: false, error: messageText });
  });

  return true;
});
