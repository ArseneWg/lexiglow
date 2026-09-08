import { afterEach, describe, expect, test, vi } from "vitest";

import { STORAGE_SETTINGS_KEY } from "../src/shared/constants";
import { CURRENT_USER_SETTINGS_SCHEMA_VERSION } from "../src/shared/settings";
import { getSettings } from "../src/shared/storage";

describe("persistent settings schema migration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("rewrites unversioned local settings once and leaves the migrated record stable", async () => {
    const localStore: Record<string, unknown> = {
      [STORAGE_SETTINGS_KEY]: {
        knownBaseRank: 3600,
        masteredOverrides: ["worked"],
        unmasteredOverrides: [],
        ignoredWords: [],
        wordReviewTrigger: "doubleClick",
      },
    };
    const localSet = vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(localStore, value);
    });
    const syncGet = vi.fn(async () => ({}));

    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
          set: localSet,
        },
        sync: {
          get: syncGet,
          set: vi.fn(async () => undefined),
        },
      },
    });

    const first = await getSettings();
    expect(first.schemaVersion).toBe(CURRENT_USER_SETTINGS_SCHEMA_VERSION);
    expect(first.masteredOverrides).toContain("work");
    expect(localSet).toHaveBeenCalledTimes(1);
    expect(localStore[STORAGE_SETTINGS_KEY]).toEqual(expect.objectContaining({
      schemaVersion: CURRENT_USER_SETTINGS_SCHEMA_VERSION,
      masteredOverrides: ["work"],
    }));

    localSet.mockClear();
    const second = await getSettings();
    expect(second).toEqual(first);
    expect(localSet).not.toHaveBeenCalled();
    expect(syncGet).not.toHaveBeenCalled();
  });
});
