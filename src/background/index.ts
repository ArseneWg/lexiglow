import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type {
  AnalyzeSelectionMessage,
  GetSettingsMessage,
  GetTranslatorSettingsMessage,
  LookupPronunciationMessage,
  LookupWordMessage,
  PronunciationLookupResponse,
  PronunciationResponse,
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
  extractPronunciation,
  hasEnglishVoice,
  selectVoiceForAccent,
} from "../shared/pronunciation";
import {
  removeWordIgnored,
  resolveWordFlags,
  estimateLearnerLevel,
  setWordIgnored,
  setWordMastered,
  setWordUnmastered,
  updateKnownBaseRank,
} from "../shared/settings";
import {
  getCachedSelectionTranslation,
  getCachedTranslation,
  getCachedPronunciation,
  getCachedEnglishExplanation,
  getSettings,
  getTranslatorSettings,
  saveSettings,
  saveTranslatorSettings,
  setCachedSelectionTranslation,
  setCachedTranslation,
  setCachedPronunciation,
  setCachedEnglishExplanation,
} from "../shared/storage";
import {
  analyzeSentenceWithLlm,
  explainWordInEnglishWithLlm,
  isTranslatorFallbackError,
  translateSelectionWithLlm,
  translateWithGoogle,
  translateWithLlm,
} from "../shared/translator";
import type {
  CacheEntry,
  EnglishExplanationResult,
  LexiconLookupResult,
  PronunciationAccent,
  PronunciationResult,
  SentenceAnalysisResult,
  TranslationResult,
} from "../shared/types";

const inFlightTranslations = new Map<string, Promise<TranslationResult>>();
const inFlightPronunciations = new Map<string, Promise<PronunciationResult>>();
const inFlightEnglishExplanations = new Map<string, Promise<EnglishExplanationResult>>();

async function translateByChoice({
  provider,
  lemma,
  surface,
  contextText,
  responseMode,
}: {
  provider: TranslationProviderChoice;
  lemma: string;
  surface: string;
  contextText: string;
  responseMode?: "word" | "sentence";
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
      responseMode: responseMode ?? "word",
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
  responseMode: "word" | "sentence",
): Promise<CacheEntry | TranslationResult> {
  const cacheProviderKey = `${provider}:${responseMode}`;
  const requestKey = `${cacheProviderKey}::${lemma}::${contextText}`;
  const cached = await getCachedTranslation(lemma, contextText, cacheProviderKey);

  if (cached?.translation) {
    return {
      translation: cached.translation,
      sentenceTranslation: cached.sentenceTranslation,
      englishExplanation: cached.englishExplanation,
      provider: cached.provider,
      cached: true,
    };
  }

  let pending = inFlightTranslations.get(requestKey);

  if (!pending) {
    pending = translateByChoice({ provider, lemma, surface, contextText, responseMode });
    inFlightTranslations.set(requestKey, pending);
  }

  try {
    const result = await pending;
    await setCachedTranslation(lemma, contextText, cacheProviderKey, {
      translation: result.translation,
      sentenceTranslation: result.sentenceTranslation,
      englishExplanation: result.englishExplanation,
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
  const cacheProviderKey = `${provider}:selection-v2`;
  const requestKey = `selection::${cacheProviderKey}::${text}::${contextText}`;
  const cached = await getCachedSelectionTranslation(text, contextText, cacheProviderKey);

  if (cached?.translation) {
    return {
      translation: cached.translation,
      sentenceTranslation: cached.sentenceTranslation,
      englishExplanation: cached.englishExplanation,
      provider: cached.provider,
      cached: true,
    };
  }

  let pending = inFlightTranslations.get(requestKey);

  if (!pending) {
    pending = (async () => {
      if (provider === "google") {
        return translateWithGoogle({ lemma: text, surface: text });
      }

      const translatorSettings = await getTranslatorSettings();

      try {
        return await translateSelectionWithLlm({
          text,
          contextText,
          settings: translatorSettings,
        });
      } catch (error) {
        if (!translatorSettings.fallbackToGoogle || !isTranslatorFallbackError(error)) {
          throw error;
        }

        return translateWithGoogle({ lemma: text, surface: text });
      }
    })();
    inFlightTranslations.set(requestKey, pending);
  }

  try {
    const result = await pending;
    await setCachedSelectionTranslation(text, contextText, cacheProviderKey, {
      translation: result.translation,
      sentenceTranslation: result.sentenceTranslation,
      englishExplanation: result.englishExplanation,
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
    const translatorSettings = provider === "llm" ? await getTranslatorSettings() : null;
    const englishMode = provider === "llm" && translatorSettings?.llmDisplayMode === "english";
    const translationMode =
      provider === "llm" && translatorSettings?.llmDisplayMode === "sentence" ? "sentence" : "word";

    return {
      lemma,
      surface,
      rank,
      ...flags,
      isIgnored: false,
      isKnown: false,
      shouldTranslate: true,
      reason: "translate",
      ...(englishMode
        ? await (async () => {
            const explanation = await getOrExplainWordInEnglish(lemma, surface, contextText);
            return {
              translation: explanation.meaning,
              sentenceTranslation: undefined,
              englishExplanation: explanation.explanation,
              translationProvider: explanation.provider,
              cached: explanation.cached,
            };
          })()
        : await (async () => {
            const translation = await getOrTranslate(
              lemma,
              surface,
              contextText,
              provider,
              translationMode,
            );
            return {
              translation: translation.translation,
              sentenceTranslation: translation.sentenceTranslation,
              englishExplanation: translation.englishExplanation,
              translationProvider: translation.provider,
              cached: translation.cached,
            };
          })()),
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
      englishExplanation: undefined,
      translationProvider: provider === "llm" ? "deepseek-chat" : "google-web",
      cached: false,
    };
  }
}

async function getOrExplainWordInEnglish(
  lemma: string,
  surface: string,
  contextText: string,
): Promise<EnglishExplanationResult> {
  const userSettings = await getSettings();
  const learnerLevel = estimateLearnerLevel(userSettings);
  const requestKey = `explain::${learnerLevel}::${lemma}::${contextText}`;
  const cached = await getCachedEnglishExplanation(lemma, contextText, learnerLevel);

  if (cached?.meaning && cached?.explanation) {
    return {
      meaning: cached.meaning,
      explanation: cached.explanation,
      provider: cached.provider,
      cached: true,
    };
  }

  let pending = inFlightEnglishExplanations.get(requestKey);

  if (!pending) {
    pending = (async () => {
      const translatorSettings = await getTranslatorSettings();

      return explainWordInEnglishWithLlm({
        surface,
        contextText,
        settings: translatorSettings,
        userSettings,
      });
    })();
    inFlightEnglishExplanations.set(requestKey, pending);
  }

  try {
    const result = await pending;
    await setCachedEnglishExplanation(lemma, contextText, learnerLevel, {
      meaning: result.meaning,
      explanation: result.explanation,
      provider: result.provider,
      updatedAt: Date.now(),
    });
    return result;
  } finally {
    inFlightEnglishExplanations.delete(requestKey);
  }
}

async function handleAnalyzeSelection(
  message: AnalyzeSelectionMessage,
): Promise<SentenceAnalysisResult> {
  const text = message.payload.text.trim();
  const translatorSettings = await getTranslatorSettings();
  try {
    return await analyzeSentenceWithLlm({
      text,
      settings: translatorSettings,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "";
    console.warn("[LexiGlow][sentence-analysis][background]", {
      text,
      message: messageText,
    });

    if (/json|parse|format/i.test(messageText)) {
      throw new Error("长难句分析返回格式不稳定，请重试一次。");
    }

    throw error;
  }
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

async function getOrLookupPronunciation(surface: string): Promise<PronunciationResult> {
  const normalized = surface.trim().toLowerCase();

  if (!normalized) {
    return {
      cached: false,
    };
  }

  const cached = await getCachedPronunciation(normalized);

  if (cached) {
    return {
      ukPhonetic: cached.ukPhonetic,
      usPhonetic: cached.usPhonetic,
      ukAudioUrl: cached.ukAudioUrl,
      usAudioUrl: cached.usAudioUrl,
      cached: true,
    };
  }

  let pending = inFlightPronunciations.get(normalized);

  if (!pending) {
    pending = (async () => {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`,
      );

      if (!response.ok) {
        return {
          cached: false,
        };
      }

      const payload = (await response.json().catch(() => null)) as unknown;
      const firstEntry = Array.isArray(payload) && payload.length > 0 ? payload[0] : null;

      if (!firstEntry || typeof firstEntry !== "object") {
        return {
          cached: false,
        };
      }

      const result = extractPronunciation(firstEntry as Parameters<typeof extractPronunciation>[0]);

      await setCachedPronunciation(normalized, {
        ukPhonetic: result.ukPhonetic,
        usPhonetic: result.usPhonetic,
        ukAudioUrl: result.ukAudioUrl,
        usAudioUrl: result.usAudioUrl,
        updatedAt: Date.now(),
      });

      return {
        ...result,
        cached: false,
      };
    })();

    inFlightPronunciations.set(normalized, pending);
  }

  try {
    return await pending;
  } finally {
    inFlightPronunciations.delete(normalized);
  }
}


async function handleLookupPronunciation(
  message: LookupPronunciationMessage,
): Promise<PronunciationLookupResponse["result"]> {
  const surface = resolveLookupLemma(message.payload.surface) || message.payload.surface.trim();

  return getOrLookupPronunciation(surface);
}

async function handleSpeakPronunciation(
  message: Extract<RuntimeMessage, { type: "SPEAK_PRONUNCIATION" }>,
): Promise<PronunciationResponse> {
  const text = message.payload.text.trim();
  const accent = message.payload.accent as PronunciationAccent;

  if (!text) {
    return { ok: false, error: "没有可发音的内容。" };
  }

  const voices = await new Promise<chrome.tts.TtsVoice[]>((resolve) => {
    chrome.tts.getVoices((items) => resolve(items ?? []));
  });

  const selectedVoice = selectVoiceForAccent(voices, accent);

  if (!selectedVoice) {
    if (hasEnglishVoice(voices)) {
      return {
        ok: false,
        error: accent === "en-US"
          ? "当前设备没有可用的美式英语语音，已避免使用不匹配口音。"
          : "当前设备没有可用的英式英语语音，已避免使用不匹配口音。",
      };
    }

    return { ok: false, error: "当前设备没有可用英语语音。" };
  }

  chrome.tts.stop();

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    chrome.tts.speak(text, {
      lang: accent,
      voiceName: selectedVoice.voiceName,
      rate: 0.92,
      pitch: 1,
      volume: 1,
      enqueue: false,
      onEvent(event) {
        if (settled) {
          return;
        }

        if (event.type === "error") {
          settled = true;
          reject(new Error(event.errorMessage || "发音播放失败。"));
          return;
        }

        if (
          event.type === "start" ||
          event.type === "end" ||
          event.type === "interrupted" ||
          event.type === "cancelled"
        ) {
          settled = true;
          resolve();
        }
      },
    });
  });

  return { ok: true };
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
      case "LOOKUP_PRONUNCIATION":
        sendResponse({ ok: true, result: await handleLookupPronunciation(message) });
        break;
      case "SPEAK_PRONUNCIATION":
        sendResponse(await handleSpeakPronunciation(message));
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
