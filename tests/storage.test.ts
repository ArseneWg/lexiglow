import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { STORAGE_SETTINGS_KEY, STORAGE_TRANSLATOR_SETTINGS_KEY } from "../src/shared/constants";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import {
  DEFAULT_TRANSLATOR_PROFILE,
  DEFAULT_TRANSLATOR_SETTINGS,
} from "../src/shared/translator";
import {
  getSettings,
  getTranslatorSettings,
  getTranslatorSettingsState,
  saveSettings,
  saveTranslatorSettings,
  saveTranslatorSettingsState,
} from "../src/shared/storage";

type StorageAreaMock = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
};

describe("settings storage", () => {
  let localStore: Record<string, unknown>;
  let syncStore: Record<string, unknown>;
  let localArea: StorageAreaMock;
  let syncArea: StorageAreaMock;

  beforeEach(() => {
    localStore = {};
    syncStore = {};

    localArea = {
      get: vi.fn(async (key?: string) => {
        if (!key) {
          return { ...localStore };
        }

        return { [key]: localStore[key] };
      }),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(localStore, value);
      }),
    };

    syncArea = {
      get: vi.fn(async (key?: string) => {
        if (!key) {
          return { ...syncStore };
        }

        return { [key]: syncStore[key] };
      }),
      set: vi.fn(async (value: Record<string, unknown>) => {
        Object.assign(syncStore, value);
      }),
    };

    vi.stubGlobal("chrome", {
      storage: {
        local: localArea,
        sync: syncArea,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("prefers local settings over sync", async () => {
    localStore[STORAGE_SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      knownBaseRank: 1234,
    };
    syncStore[STORAGE_SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      knownBaseRank: 5678,
    };

    const settings = await getSettings();

    expect(settings.knownBaseRank).toBe(1234);
    expect(syncArea.get).not.toHaveBeenCalled();
  });

  test("migrates legacy sync settings into local storage", async () => {
    syncStore[STORAGE_SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      knownBaseRank: 4321,
    };

    const settings = await getSettings();

    expect(settings.knownBaseRank).toBe(4321);
    expect(localArea.set).toHaveBeenCalledWith({
      [STORAGE_SETTINGS_KEY]: expect.objectContaining({
        knownBaseRank: 4321,
      }),
    });
  });

  test("writes user settings to local storage only", async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      knownBaseRank: 2468,
    });

    expect(localArea.set).toHaveBeenCalledWith({
      [STORAGE_SETTINGS_KEY]: expect.objectContaining({
        knownBaseRank: 2468,
      }),
    });
    expect(syncArea.set).not.toHaveBeenCalled();
  });

  test("defaults translator settings to zh-CN learner language", async () => {
    const settings = await getTranslatorSettings();

    expect(settings).toEqual(expect.objectContaining({
      defaultTranslationProvider: "google",
      learnerLanguageCode: "zh-CN",
    }));
  });

  test("defaults translator settings state to one profile", async () => {
    const state = await getTranslatorSettingsState();

    expect(state.activeProfileId).toBe(DEFAULT_TRANSLATOR_PROFILE.id);
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toEqual(expect.objectContaining({
      id: DEFAULT_TRANSLATOR_PROFILE.id,
      name: DEFAULT_TRANSLATOR_PROFILE.name,
      learnerLanguageCode: "zh-CN",
    }));
  });

  test("writes translator settings to local storage only", async () => {
    await saveTranslatorSettings({
      ...DEFAULT_TRANSLATOR_SETTINGS,
      defaultTranslationProvider: "llm",
      learnerLanguageCode: "ja",
    });

    expect(localArea.set).toHaveBeenCalledWith({
      [STORAGE_TRANSLATOR_SETTINGS_KEY]: expect.objectContaining({
        activeProfileId: DEFAULT_TRANSLATOR_PROFILE.id,
        profiles: [
          expect.objectContaining({
            id: DEFAULT_TRANSLATOR_PROFILE.id,
            defaultTranslationProvider: "llm",
            learnerLanguageCode: "ja",
          }),
        ],
      }),
    });
    expect(syncArea.set).not.toHaveBeenCalled();
  });

  test("reads the active translator profile from settings state", async () => {
    localStore[STORAGE_TRANSLATOR_SETTINGS_KEY] = {
      activeProfileId: "local-qwen",
      profiles: [
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "default-openai",
          name: "OpenAI",
          providerModel: "gpt-4.1-mini",
        },
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "local-qwen",
          name: "Local Qwen",
          defaultTranslationProvider: "llm",
          learnerLanguageCode: "ja",
          providerBaseUrl: "https://gpustack.rock-chips.com/v1",
          providerModel: "qwen3.5-397b-a17b",
        },
      ],
    };

    const settings = await getTranslatorSettings();

    expect(settings).toEqual(expect.objectContaining({
      defaultTranslationProvider: "llm",
      learnerLanguageCode: "ja",
      providerModel: "qwen3.5-397b-a17b",
    }));
  });

  test("writes translator settings state to local storage only", async () => {
    await saveTranslatorSettingsState({
      activeProfileId: "local-qwen",
      profiles: [
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "default-openai",
          name: "OpenAI",
        },
        {
          ...DEFAULT_TRANSLATOR_PROFILE,
          id: "local-qwen",
          name: "Local Qwen",
          defaultTranslationProvider: "llm",
          learnerLanguageCode: "ja",
          providerBaseUrl: "https://gpustack.rock-chips.com/v1",
          providerModel: "qwen3.5-397b-a17b",
        },
      ],
    });

    expect(localArea.set).toHaveBeenCalledWith({
      [STORAGE_TRANSLATOR_SETTINGS_KEY]: expect.objectContaining({
        activeProfileId: "local-qwen",
        profiles: expect.arrayContaining([
          expect.objectContaining({
            id: "default-openai",
            name: "OpenAI",
          }),
          expect.objectContaining({
            id: "local-qwen",
            name: "Local Qwen",
            defaultTranslationProvider: "llm",
          }),
        ]),
      }),
    });
    expect(syncArea.set).not.toHaveBeenCalled();
  });
});
