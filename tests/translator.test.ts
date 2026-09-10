import { afterEach, describe, expect, test, vi } from "vitest";

import {
  analyzeSentenceWithLlm,
  DEFAULT_TRANSLATOR_PROFILE,
  getLlmCacheSignature,
  getTranslatorCacheTtlMs,
  parseEnglishExplanationResponse,
  parseGoogleTranslateResponse,
  parseLlmTranslationResponse,
  parseSentenceAnalysisResponse,
  resolveActiveTranslatorProfile,
  sanitizeTranslatorProfile,
  sanitizeTranslatorSettings,
  sanitizeTranslatorSettingsState,
  summarizeDictionaryPartOfSpeech,
  translateSelectionWithLlm,
} from "../src/shared/translator";
import { getDisplayClauseBlocks } from "../src/shared/sentenceAnalysisDisplay";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("google response parsing", () => {
  test("joins translation segments", () => {
    const payload = [[["你好", "hello", null, null, 10]], null, "en"];
    expect(parseGoogleTranslateResponse(payload)).toBe("你好");
  });

  test("returns empty string for unexpected payloads", () => {
    expect(parseGoogleTranslateResponse({})).toBe("");
  });
});

describe("llm response parsing", () => {
  test("reads structured word and sentence translations", () => {
    expect(
      parseLlmTranslationResponse('{"word":"收到的","sentence":"我们昨天收到了你的包裹。","pos":"verb"}'),
    ).toEqual({
      translation: "收到的",
      sentenceTranslation: "我们昨天收到了你的包裹。",
      contextualPartOfSpeech: "v.",
    });
  });

  test("keeps contextual hints but ignores model-provided alternative meanings", () => {
    expect(parseLlmTranslationResponse(JSON.stringify({
      word: "瓦解",
      pos: "verb",
      hint: "系统或机制突然失效",
      alternatives: [
        { meaning: "倒塌", hint: "建筑物或结构", pos: "verb" },
        { meaning: "倒下", hint: "人因虚弱或疾病", pos: "verb" },
      ],
    }))).toEqual({
      translation: "瓦解",
      contextualPartOfSpeech: "v.",
      semanticHint: "系统或机制突然失效",
    });
  });

  test("falls back to plain text when response is not json", () => {
    expect(parseLlmTranslationResponse("收到的")).toEqual({
      translation: "收到的",
    });
  });

  test("defaults llm display mode to word", () => {
    expect(sanitizeTranslatorSettings({}).llmDisplayMode).toBe("word");
  });

  test("defaults the automatic translation provider to google", () => {
    expect(sanitizeTranslatorSettings({}).defaultTranslationProvider).toBe("google");
    expect(sanitizeTranslatorSettings({ defaultTranslationProvider: "llm" }).defaultTranslationProvider).toBe("llm");
  });

  test("accepts english as llm display mode", () => {
    expect(sanitizeTranslatorSettings({ llmDisplayMode: "english" }).llmDisplayMode).toBe("english");
  });

  test("defaults llm provider to OpenAI", () => {
    expect(sanitizeTranslatorSettings({}).llmProvider).toBe("openai");
  });

  test("defaults cache duration settings", () => {
    expect(sanitizeTranslatorSettings({})).toEqual(expect.objectContaining({
      learnerLanguageCode: "zh-CN",
      cacheDurationValue: 30,
      cacheDurationUnit: "minutes",
    }));
  });

  test("accepts supported learner languages and falls back for unknown ones", () => {
    expect(sanitizeTranslatorSettings({ learnerLanguageCode: "ja" }).learnerLanguageCode).toBe("ja");
    expect(sanitizeTranslatorSettings({ learnerLanguageCode: "xx" as never }).learnerLanguageCode).toBe("zh-CN");
  });

  test("computes cache ttl from value and unit", () => {
    expect(getTranslatorCacheTtlMs(sanitizeTranslatorSettings({
      cacheDurationValue: 45,
      cacheDurationUnit: "minutes",
    }))).toBe(45 * 60 * 1000);

    expect(getTranslatorCacheTtlMs(sanitizeTranslatorSettings({
      cacheDurationValue: 2,
      cacheDurationUnit: "hours",
    }))).toBe(2 * 60 * 60 * 1000);
  });

  test("uses provider-specific default base url and model", () => {
    expect(sanitizeTranslatorSettings({ llmProvider: "gemini" })).toEqual(expect.objectContaining({
      llmProvider: "gemini",
      providerBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      providerModel: "gemini-3.8-flash",
    }));

    expect(sanitizeTranslatorSettings({ llmProvider: "anthropic" })).toEqual(expect.objectContaining({
      llmProvider: "anthropic",
      providerBaseUrl: "https://api.anthropic.com/v1",
      providerModel: "claude-sonnet-5",
    }));
  });

  test("separates llm cache signatures by provider and model", () => {
    expect(getLlmCacheSignature(sanitizeTranslatorSettings({
      llmProvider: "openai",
      providerBaseUrl: "https://api.openai.com/v1/",
      providerModel: "gpt-4.1-mini",
      learnerLanguageCode: "zh-CN",
    }))).toBe("openai::https://api.openai.com/v1::gpt-4.1-mini::zh-CN");

    expect(getLlmCacheSignature(sanitizeTranslatorSettings({
      llmProvider: "gemini",
      providerBaseUrl: "https://api.openai.com/v1/",
      providerModel: "gpt-4.1-mini",
      learnerLanguageCode: "ja",
    }))).toBe("gemini::https://generativelanguage.googleapis.com/v1beta::gpt-4.1-mini::ja");
  });

  test("sanitizes translator profiles with defaults", () => {
    expect(sanitizeTranslatorProfile({
      name: "  Local Qwen  ",
      learnerLanguageCode: "ja",
    }, "local-qwen", "Local Qwen")).toEqual(expect.objectContaining({
      id: "local-qwen",
      name: "Local Qwen",
      learnerLanguageCode: "ja",
      defaultTranslationProvider: "google",
    }));
  });

  test("sanitizes translator settings state and restores a valid active profile", () => {
    const state = sanitizeTranslatorSettingsState({
      activeProfileId: "missing",
      profiles: [
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "gpu",
          name: "GPUStack",
          defaultTranslationProvider: "llm",
          providerBaseUrl: "https://gpustack.rock-chips.com/v1",
          providerModel: "qwen3.5-397b-a17b",
        },
      ],
    });

    expect(state.activeProfileId).toBe("gpu");
    expect(state.profiles[0]).toEqual(expect.objectContaining({
      id: "gpu",
      name: "GPUStack",
      defaultTranslationProvider: "llm",
    }));
  });

  test("resolves the active translator profile from state", () => {
    const state = sanitizeTranslatorSettingsState({
      activeProfileId: "local-qwen",
      profiles: [
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "openai",
          name: "OpenAI",
          providerModel: "gpt-4.1-mini",
        },
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "local-qwen",
          name: "Local Qwen",
          defaultTranslationProvider: "llm",
          providerBaseUrl: "https://gpustack.rock-chips.com/v1",
          providerModel: "qwen3.5-397b-a17b",
        },
      ],
    });

    expect(resolveActiveTranslatorProfile(state)).toEqual(expect.objectContaining({
      id: "local-qwen",
      name: "Local Qwen",
      defaultTranslationProvider: "llm",
      providerModel: "qwen3.5-397b-a17b",
    }));
  });

  test("reads structured english explanation payload", () => {
    expect(
      parseEnglishExplanationResponse(
        '{"meaning":"这里表示收到、接到。","explanation":"If you receive something, you get it from someone."}',
      ),
    ).toEqual({
      meaning: "这里表示收到、接到。",
      explanation: "If you receive something, you get it from someone.",
    });
  });

  test("reads english explanation from unified llm payload", () => {
    expect(
      parseLlmTranslationResponse(
        '{"word":"这里表示收到、接到。","english":"If you receive something, you get it from someone.","pos":"verb"}',
      ),
    ).toEqual({
      translation: "这里表示收到、接到。",
      englishExplanation: "If you receive something, you get it from someone.",
      contextualPartOfSpeech: "v.",
    });
  });

  test("normalizes contextual verb variants from llm output", () => {
    expect(
      parseLlmTranslationResponse('{"word":"合并","sentence":"合并前进行多代理代码审查。","pos":"gerund"}'),
    ).toEqual({
      translation: "合并",
      sentenceTranslation: "合并前进行多代理代码审查。",
      contextualPartOfSpeech: "v.",
    });

    expect(
      parseLlmTranslationResponse('{"word":"合并","sentence":"合并前进行多代理代码审查。","pos":"verb (gerund)"}'),
    ).toEqual({
      translation: "合并",
      sentenceTranslation: "合并前进行多代理代码审查。",
      contextualPartOfSpeech: "v.",
    });
  });

  test("summarizes dictionary part-of-speech labels", () => {
    expect(
      summarizeDictionaryPartOfSpeech([
        {
          meanings: [
            { partOfSpeech: "noun" },
            { partOfSpeech: "verb" },
            { partOfSpeech: "noun" },
          ],
        },
      ]),
    ).toBe("n. / v.");
  });

  test("ignores unknown dictionary part-of-speech labels", () => {
    expect(
      summarizeDictionaryPartOfSpeech([
        {
          meanings: [
            { partOfSpeech: "prefix" },
          ],
        },
      ]),
    ).toBeUndefined();
  });
});


