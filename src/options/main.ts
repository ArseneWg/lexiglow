import "./styles.css";

import { t } from "../shared/i18n";
import { LEXICON_WORDS, lookupRank, resolveLookupLemma } from "../shared/lexicon";
import {
  createLearningDataExport,
  MAX_LEARNING_DATA_IMPORT_BYTES,
  mergeImportedTranslatorSecrets,
  parseLearningDataExport,
  serializeLearningDataExport,
} from "../shared/learningData";
import type { RuntimeMessage, TranslatorSettingsStateResponse } from "../shared/messages";
import {
  clearLearningProgress,
  countExtraMastered,
  countTotalKnown,
  isBuiltinIgnoredWord,
  removeWordIgnored,
  resolveWordFlags,
  setWordIgnored,
  setWordMastered,
  setWordUnmastered,
  updateKnownBaseRank,
  updateWordReviewTrigger,
} from "../shared/settings";
import {
  getSettings,
  getTranslatorSettingsState,
  saveSettings,
  saveTranslatorSettingsState,
} from "../shared/storage";
import {
  DEFAULT_TRANSLATOR_PROFILE,
  DEFAULT_TRANSLATOR_SETTINGS,
  DEFAULT_TRANSLATOR_SETTINGS_STATE,
  getDefaultLlmBaseUrl,
  getDefaultLlmModel,
  LEARNER_LANGUAGE_OPTIONS,
  resolveActiveTranslatorProfile,
  sanitizeTranslatorProfile,
} from "../shared/translator";
import type { TranslatorProfile, TranslatorSettings, TranslatorSettingsState, UserSettings } from "../shared/types";
import { getLlmProviderDefinition, isLlmProviderKind, LLM_PROVIDER_OPTIONS } from "../shared/llm/providerRegistry";

interface SearchEntry {
  lemma: string;
  rank: number | null;
}

function runtimeSend<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

const appRoot = app;

let settings: UserSettings;
let translatorSettings: TranslatorSettings = DEFAULT_TRANSLATOR_SETTINGS;
let translatorSettingsState: TranslatorSettingsState = DEFAULT_TRANSLATOR_SETTINGS_STATE;

let rankValue!: HTMLElement;
let rankRange!: HTMLInputElement;
let rankNumber!: HTMLInputElement;
let baseKnownCount!: HTMLElement;
let totalKnownCount!: HTMLElement;
let extraKnownCount!: HTMLElement;
let ignoredCount!: HTMLElement;
let wordReviewTrigger!: HTMLSelectElement;
let searchInput!: HTMLInputElement;
let searchResults!: HTMLElement;
let profileSelect!: HTMLSelectElement;
let newProfileButton!: HTMLButtonElement;
let duplicateProfileButton!: HTMLButtonElement;
let renameProfileButton!: HTMLButtonElement;
let deleteProfileButton!: HTMLButtonElement;
let learnerLanguageCode!: HTMLSelectElement;
let defaultTranslationProvider!: HTMLSelectElement;
let llmProvider!: HTMLSelectElement;
let providerBaseUrl!: HTMLInputElement;
let providerModel!: HTMLInputElement;
let providerApiKey!: HTMLInputElement;
let providerHint!: HTMLElement;
let llmDisplayMode!: HTMLSelectElement;
let cacheDurationValue!: HTMLInputElement;
let cacheDurationUnit!: HTMLSelectElement;
let fallbackToGoogle!: HTMLInputElement;
let saveTranslatorButton!: HTMLButtonElement;
let settingsStatusEls!: HTMLElement[];
let settingsStatusTimer: number | null = null;
let masteredList!: HTMLElement;
let ignoredList!: HTMLElement;
let exportDataButton!: HTMLButtonElement;
let importDataButton!: HTMLButtonElement;
let importDataInput!: HTMLInputElement;
let clearButton!: HTMLButtonElement;

function ui(key: Parameters<typeof t>[1], variables?: Record<string, string | number>): string {
  return t(translatorSettings.learnerLanguageCode, key, variables);
}

function renderLanguageOptionsMarkup(): string {
  return LEARNER_LANGUAGE_OPTIONS
    .map((option) => {
      const selected = option.code === translatorSettings.learnerLanguageCode ? ' selected' : "";
      return `<option value="${option.code}"${selected}>${option.nativeLabel}</option>`;
    })
    .join("");
}

function renderLlmProviderOptionsMarkup(): string {
  return LLM_PROVIDER_OPTIONS.map((provider) => `<option value="${provider.kind}">${provider.label}</option>`).join("");
}

function renderProfileOptionsMarkup(): string {
  return translatorSettingsState.profiles
    .map((profile) => {
      const selected = profile.id === translatorSettingsState.activeProfileId ? ' selected' : "";
      return `<option value="${profile.id}"${selected}>${profile.name}</option>`;
    })
    .join("");
}

function getActiveProfile(): TranslatorProfile {
  return resolveActiveTranslatorProfile(translatorSettingsState);
}

function updateActiveTranslatorSettings() {
  translatorSettings = getActiveProfile();
}

function createProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildProfileFromForm(profile: TranslatorProfile): TranslatorProfile {
  return sanitizeTranslatorProfile({
    id: profile.id,
    name: profile.name,
    llmProvider: isLlmProviderKind(llmProvider.value) ? llmProvider.value : "openai",
    defaultTranslationProvider: defaultTranslationProvider.value === "llm" ? "llm" : "google",
    learnerLanguageCode: learnerLanguageCode.value as TranslatorSettings["learnerLanguageCode"],
    providerBaseUrl: providerBaseUrl.value,
    providerModel: providerModel.value,
    apiKey: providerApiKey.value,
    llmDisplayMode:
      llmDisplayMode.value === "sentence"
        ? "sentence"
        : llmDisplayMode.value === "english"
          ? "english"
          : "word",
    cacheDurationValue: Number(cacheDurationValue.value),
    cacheDurationUnit: cacheDurationUnit.value === "hours" ? "hours" : "minutes",
    fallbackToGoogle: fallbackToGoogle.checked,
  }, profile.id, profile.name);
}

function syncActiveProfileFromForm() {
  const activeProfile = getActiveProfile();
  const nextProfile = buildProfileFromForm(activeProfile);

  translatorSettingsState = {
    ...translatorSettingsState,
    profiles: translatorSettingsState.profiles.map((profile) =>
      profile.id === activeProfile.id ? nextProfile : profile),
  };
  translatorSettings = nextProfile;
}

function promptProfileName(initialValue: string): string | null {
  const value = window.prompt(ui("optionsProfileNamePrompt"), initialValue);
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function createProfile(name: string, seed?: Partial<TranslatorProfile>): TranslatorProfile {
  const id = createProfileId();

  return sanitizeTranslatorProfile({
    ...DEFAULT_TRANSLATOR_PROFILE,
    ...seed,
    id,
    name,
  }, id, name);
}

function setTranslatorSettingsState(state: TranslatorSettingsState) {
  translatorSettingsState = state;
  updateActiveTranslatorSettings();
}

function assignRefs() {
  rankValue = document.querySelector<HTMLElement>("#rankValue")!;
  rankRange = document.querySelector<HTMLInputElement>("#rankRange")!;
  rankNumber = document.querySelector<HTMLInputElement>("#rankNumber")!;
  baseKnownCount = document.querySelector<HTMLElement>("#baseKnownCount")!;
  totalKnownCount = document.querySelector<HTMLElement>("#totalKnownCount")!;
  extraKnownCount = document.querySelector<HTMLElement>("#extraKnownCount")!;
  ignoredCount = document.querySelector<HTMLElement>("#ignoredCount")!;
  wordReviewTrigger = document.querySelector<HTMLSelectElement>("#wordReviewTrigger")!;
  searchInput = document.querySelector<HTMLInputElement>("#searchInput")!;
  searchResults = document.querySelector<HTMLElement>("#searchResults")!;
  profileSelect = document.querySelector<HTMLSelectElement>("#profileSelect")!;
  newProfileButton = document.querySelector<HTMLButtonElement>("#newProfileButton")!;
  duplicateProfileButton = document.querySelector<HTMLButtonElement>("#duplicateProfileButton")!;
  renameProfileButton = document.querySelector<HTMLButtonElement>("#renameProfileButton")!;
  deleteProfileButton = document.querySelector<HTMLButtonElement>("#deleteProfileButton")!;
  learnerLanguageCode = document.querySelector<HTMLSelectElement>("#learnerLanguageCode")!;
  defaultTranslationProvider = document.querySelector<HTMLSelectElement>("#defaultTranslationProvider")!;
  llmProvider = document.querySelector<HTMLSelectElement>("#llmProvider")!;
  providerBaseUrl = document.querySelector<HTMLInputElement>("#providerBaseUrl")!;
  providerModel = document.querySelector<HTMLInputElement>("#providerModel")!;
  providerApiKey = document.querySelector<HTMLInputElement>("#providerApiKey")!;
  providerHint = document.querySelector<HTMLElement>("#providerHint")!;
  llmDisplayMode = document.querySelector<HTMLSelectElement>("#llmDisplayMode")!;
  cacheDurationValue = document.querySelector<HTMLInputElement>("#cacheDurationValue")!;
  cacheDurationUnit = document.querySelector<HTMLSelectElement>("#cacheDurationUnit")!;
  fallbackToGoogle = document.querySelector<HTMLInputElement>("#fallbackToGoogle")!;
  saveTranslatorButton = document.querySelector<HTMLButtonElement>("#saveTranslatorButton")!;
  settingsStatusEls = [...document.querySelectorAll<HTMLElement>(".settings-status")];
  masteredList = document.querySelector<HTMLElement>("#masteredList")!;
  ignoredList = document.querySelector<HTMLElement>("#ignoredList")!;
  exportDataButton = document.querySelector<HTMLButtonElement>("#exportDataButton")!;
  importDataButton = document.querySelector<HTMLButtonElement>("#importDataButton")!;
  importDataInput = document.querySelector<HTMLInputElement>("#importDataInput")!;
  clearButton = document.querySelector<HTMLButtonElement>("#clearButton")!;
}

function setRankInputs(value: number) {
  const stringValue = String(value);
  rankValue.textContent = stringValue;
  rankRange.value = stringValue;
  rankNumber.value = stringValue;
  baseKnownCount.textContent = stringValue;
}

function searchLexicon(query: string): SearchEntry[] {
  const normalized = resolveLookupLemma(query);

  if (!normalized) {
    return [];
  }

  const directRank = lookupRank(normalized);
  const results: SearchEntry[] = [];

  if (directRank !== null) {
    results.push({ lemma: normalized, rank: directRank });
  }

  for (const word of LEXICON_WORDS) {
    if (results.length >= 12) {
      break;
    }

    if (word === normalized) {
      continue;
    }

    if (word.includes(normalized)) {
      results.push({ lemma: word, rank: lookupRank(word) });
    }
  }

  if (!results.some((entry) => entry.lemma === normalized)) {
    results.unshift({ lemma: normalized, rank: directRank });
  }

  return results.slice(0, 12);
}

function wordStatusMarkup(lemma: string, rank: number | null): string {
  const flags = resolveWordFlags(lemma, rank, settings, lemma);
  const labels: string[] = [];

  if (flags.isIgnored) {
    labels.push(`<span class="pill">${ui("statusIgnored")}</span>`);
  } else if (flags.isKnown) {
    labels.push(`<span class="pill">${ui("statusKnown")}</span>`);
  } else {
    labels.push(`<span class="pill">${ui("statusReview")}</span>`);
  }

  if (rank !== null) {
    labels.push(`<span class="pill">#${rank}</span>`);
  } else {
    labels.push(`<span class="pill">${ui("statusOutOfList")}</span>`);
  }

  if (isBuiltinIgnoredWord(lemma)) {
    labels.push(`<span class="pill">${ui("statusBuiltInIgnore")}</span>`);
  }

  return labels.join(" ");
}

function renderSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.innerHTML = `<p class="muted">${ui("optionsTypeWordToManage")}</p>`;
    return;
  }

  const entries = searchLexicon(query);

  if (!entries.length) {
    searchResults.innerHTML = `<p class="muted">${ui("optionsNoMatchingWords")}</p>`;
    return;
  }

  searchResults.innerHTML = entries
    .map((entry) => {
      const flags = resolveWordFlags(entry.lemma, entry.rank, settings, entry.lemma);
      const knownActionLabel = flags.isKnown ? ui("actionMarkUnknown") : ui("actionMarkKnown");
      const knownActionTitle = flags.isKnown ? ui("actionMarkUnknownTitle") : ui("actionMarkKnownTitle");
      const ignoreActionLabel =
        flags.isIgnored && !isBuiltinIgnoredWord(entry.lemma) ? ui("actionStopIgnoring") : ui("actionIgnore");

      return `
        <div class="word-row" data-lemma="${entry.lemma}" data-rank="${entry.rank ?? ""}">
          <div class="word-row-header">
            <strong>${entry.lemma}</strong>
            <div>${wordStatusMarkup(entry.lemma, entry.rank)}</div>
          </div>
          <div class="word-actions">
            ${
              !flags.isIgnored
                ? `<button class="primary" data-action="toggle-known" title="${knownActionTitle}">${knownActionLabel}</button>`
                : ""
            }
            ${
              isBuiltinIgnoredWord(entry.lemma)
                ? ""
                : `<button class="secondary" data-action="toggle-ignored">${ignoreActionLabel}</button>`
            }
          </div>
        </div>
      `;
    })
    .join("");
}

function renderMasteredList() {
  if (!settings.masteredOverrides.length) {
    masteredList.innerHTML = `<p class="muted">${ui("optionsNoManualKnownWords")}</p>`;
    return;
  }

  masteredList.innerHTML = settings.masteredOverrides
    .map(
      (lemma) => `
        <div class="word-row" data-mastered="${lemma}">
          <div class="word-row-header">
            <strong>${lemma}</strong>
            <div>${wordStatusMarkup(lemma, lookupRank(lemma))}</div>
          </div>
          <div class="word-actions">
            <button class="secondary" data-action="remove-mastered">${ui("actionMarkUnknown")}</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderIgnoredList() {
  if (!settings.ignoredWords.length) {
    ignoredList.innerHTML = `<p class="muted">${ui("optionsNoIgnoredWords")}</p>`;
    return;
  }

  ignoredList.innerHTML = settings.ignoredWords
    .map(
      (lemma) => `
        <div class="word-row" data-ignored="${lemma}">
          <div class="word-row-header">
            <strong>${lemma}</strong>
            <div>${wordStatusMarkup(lemma, lookupRank(lemma))}</div>
          </div>
          <div class="word-actions">
            <button class="secondary" data-action="remove-ignored">${ui("actionStopIgnoring")}</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function syncProviderFieldPolicy() {
  const provider = isLlmProviderKind(llmProvider.value) ? llmProvider.value : "openai";
  const definition = getLlmProviderDefinition(provider);
  providerBaseUrl.readOnly = !definition.customBaseUrl;
  providerBaseUrl.setAttribute("aria-readonly", String(!definition.customBaseUrl));
  providerHint.textContent = definition.customBaseUrl
    ? ui("optionsProviderCustomHint")
    : ui("optionsProviderNativeHint", { provider: definition.label, api: definition.nativeApi });
}

function renderAll() {
  setRankInputs(settings.knownBaseRank);
  totalKnownCount.textContent = String(countTotalKnown(settings));
  extraKnownCount.textContent = String(countExtraMastered(settings));
  ignoredCount.textContent = String(settings.ignoredWords.length);
  wordReviewTrigger.value = settings.wordReviewTrigger;
  profileSelect.value = translatorSettingsState.activeProfileId;
  deleteProfileButton.disabled = translatorSettingsState.profiles.length <= 1;
  learnerLanguageCode.value = translatorSettings.learnerLanguageCode;
  defaultTranslationProvider.value = translatorSettings.defaultTranslationProvider;
  llmProvider.value = translatorSettings.llmProvider;
  providerBaseUrl.value = translatorSettings.providerBaseUrl;
  providerModel.value = translatorSettings.providerModel;
  providerApiKey.value = translatorSettings.apiKey;
  syncProviderFieldPolicy();
  llmDisplayMode.value = translatorSettings.llmDisplayMode;
  cacheDurationValue.value = String(translatorSettings.cacheDurationValue);
  cacheDurationUnit.value = translatorSettings.cacheDurationUnit;
  fallbackToGoogle.checked = translatorSettings.fallbackToGoogle;
  renderSearch();
  renderMasteredList();
  renderIgnoredList();
}

function formatStatusTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function showSettingsStatus(kind: "pending" | "success" | "error", text: string, clearAfterMs = 0) {
  if (settingsStatusTimer) {
    window.clearTimeout(settingsStatusTimer);
    settingsStatusTimer = null;
  }

  for (const element of settingsStatusEls) {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  if (clearAfterMs > 0) {
    settingsStatusTimer = window.setTimeout(() => {
      for (const element of settingsStatusEls) {
        element.textContent = "";
        delete element.dataset.kind;
      }
      settingsStatusTimer = null;
    }, clearAfterMs);
  }
}

async function persistSettings(nextSettings: UserSettings, showStatus = false) {
  settings = nextSettings;
  try {
    if (showStatus) {
      showSettingsStatus("pending", ui("optionsSavePending"));
    }
    await saveSettings(settings);
    renderAll();
    if (showStatus) {
      showSettingsStatus("success", ui("optionsSaveSuccess", { time: formatStatusTime() }), 2600);
    }
  } catch (error) {
    if (showStatus) {
      showSettingsStatus("error", ui("optionsSaveFailed", { time: formatStatusTime() }));
    }
    throw error;
  }
}

function downloadLearningDataExport() {
  const bundle = createLearningDataExport(settings, translatorSettingsState);
  const blob = new Blob([serializeLearningDataExport(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `lexiglow-learning-data-${date}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showSettingsStatus("success", ui("optionsExportDataSuccess"), 2600);
}

async function importLearningDataFile(file: File) {
  if (file.size > MAX_LEARNING_DATA_IMPORT_BYTES) {
    throw new Error("Learning data file is too large.");
  }

  const parsed = parseLearningDataExport(await file.text());
  const nextTranslatorState = mergeImportedTranslatorSecrets(parsed.translatorSettingsState, translatorSettingsState);
  await saveSettings(parsed.userSettings);
  await saveTranslatorSettingsState(nextTranslatorState);
  settings = await getSettings();
  setTranslatorSettingsState(await getTranslatorSettingsState());
  renderShell();
  renderAll();
  showSettingsStatus("success", ui("optionsImportDataSuccess"), 3200);
}

function bindEvents() {
  rankRange.addEventListener("input", async () => {
    await persistSettings(updateKnownBaseRank(settings, Number(rankRange.value)));
  });

  rankNumber.addEventListener("change", async () => {
    await persistSettings(updateKnownBaseRank(settings, Number(rankNumber.value)));
  });

  searchInput.addEventListener("input", () => {
    renderSearch();
  });

  wordReviewTrigger.addEventListener("change", async () => {
    await persistSettings(updateWordReviewTrigger(
      settings,
      wordReviewTrigger.value === "selection" ? "selection" : "doubleClick",
    ), true);
  });

  searchResults.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const action = target?.dataset.action;
    const row = target?.closest<HTMLElement>("[data-lemma]");

    if (!action || !row) {
      return;
    }

    const lemma = row.dataset.lemma ?? "";
    const rankRaw = row.dataset.rank ?? "";
    const rank = rankRaw ? Number(rankRaw) : null;
    const flags = resolveWordFlags(lemma, rank, settings, lemma);

    if (action === "toggle-known") {
      const next = flags.isKnown
        ? setWordUnmastered(settings, lemma, rank)
        : setWordMastered(settings, lemma);
      await persistSettings(next);
      return;
    }

    if (action === "toggle-ignored" && !isBuiltinIgnoredWord(lemma)) {
      const next = flags.isIgnored ? removeWordIgnored(settings, lemma) : setWordIgnored(settings, lemma);
      await persistSettings(next);
    }
  });

  masteredList.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.dataset.action !== "remove-mastered") {
      return;
    }

    const row = target.closest<HTMLElement>("[data-mastered]");
    const lemma = row?.dataset.mastered ?? "";
    await persistSettings(setWordUnmastered(settings, lemma, lookupRank(lemma)));
  });

  ignoredList.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.dataset.action !== "remove-ignored") {
      return;
    }

    const row = target.closest<HTMLElement>("[data-ignored]");
    const lemma = row?.dataset.ignored ?? "";
    await persistSettings(removeWordIgnored(settings, lemma));
  });

  exportDataButton.addEventListener("click", () => {
    downloadLearningDataExport();
  });

  importDataButton.addEventListener("click", () => {
    importDataInput.value = "";
    importDataInput.click();
  });

  importDataInput.addEventListener("change", async () => {
    const file = importDataInput.files?.[0];
    if (!file) return;
    showSettingsStatus("pending", ui("optionsImportDataPending"));
    try {
      await importLearningDataFile(file);
    } catch {
      showSettingsStatus("error", ui("optionsImportDataFailed"));
    }
  });

  clearButton.addEventListener("click", async () => {
    await persistSettings(clearLearningProgress(settings));
  });

  profileSelect.addEventListener("change", () => {
    syncActiveProfileFromForm();
    translatorSettingsState = {
      ...translatorSettingsState,
      activeProfileId: profileSelect.value,
    };
    updateActiveTranslatorSettings();
    renderShell();
    renderAll();
  });

  newProfileButton.addEventListener("click", () => {
    syncActiveProfileFromForm();
    const name = promptProfileName(
      ui("optionsProfileDefaultName", {
        index: translatorSettingsState.profiles.length + 1,
      }),
    );

    if (!name) {
      return;
    }

    const profile = createProfile(name);
    translatorSettingsState = {
      activeProfileId: profile.id,
      profiles: [...translatorSettingsState.profiles, profile],
    };
    updateActiveTranslatorSettings();
    renderShell();
    renderAll();
  });

  duplicateProfileButton.addEventListener("click", () => {
    syncActiveProfileFromForm();
    const activeProfile = getActiveProfile();
    const name = promptProfileName(`${activeProfile.name} ${ui("optionsProfileCopySuffix")}`);

    if (!name) {
      return;
    }

    const profile = createProfile(name, activeProfile);
    translatorSettingsState = {
      activeProfileId: profile.id,
      profiles: [...translatorSettingsState.profiles, profile],
    };
    updateActiveTranslatorSettings();
    renderShell();
    renderAll();
  });

  renameProfileButton.addEventListener("click", () => {
    syncActiveProfileFromForm();
    const activeProfile = getActiveProfile();
    const name = promptProfileName(activeProfile.name);

    if (!name || name === activeProfile.name) {
      return;
    }

    translatorSettingsState = {
      ...translatorSettingsState,
      profiles: translatorSettingsState.profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, name } : profile),
    };
    updateActiveTranslatorSettings();
    renderShell();
    renderAll();
  });

  deleteProfileButton.addEventListener("click", () => {
    if (translatorSettingsState.profiles.length <= 1) {
      return;
    }

    syncActiveProfileFromForm();
    const activeProfile = getActiveProfile();
    const confirmed = window.confirm(
      ui("optionsDeleteProfileConfirm", {
        name: activeProfile.name,
      }),
    );

    if (!confirmed) {
      return;
    }

    const profiles = translatorSettingsState.profiles.filter((profile) => profile.id !== activeProfile.id);
    translatorSettingsState = {
      activeProfileId: profiles[0]?.id ?? DEFAULT_TRANSLATOR_PROFILE.id,
      profiles,
    };
    updateActiveTranslatorSettings();
    renderShell();
    renderAll();
  });

  saveTranslatorButton.addEventListener("click", async () => {
    syncActiveProfileFromForm();
    showSettingsStatus("pending", ui("optionsSavePending"));
    saveTranslatorButton.disabled = true;

    try {
      const response = await runtimeSend<TranslatorSettingsStateResponse>({
        type: "SAVE_TRANSLATOR_SETTINGS_STATE",
        payload: {
          state: translatorSettingsState,
        },
      });

      if (response.ok && response.state) {
        setTranslatorSettingsState(response.state);
        renderShell();
        renderAll();
        showSettingsStatus("success", ui("optionsSaveSuccess", { time: formatStatusTime() }), 2600);
      } else {
        showSettingsStatus("error", ui("optionsSaveFailed", { time: formatStatusTime() }));
      }
    } catch {
      showSettingsStatus("error", ui("optionsSaveFailed", { time: formatStatusTime() }));
    } finally {
      saveTranslatorButton.disabled = false;
    }
  });

  llmProvider.addEventListener("change", () => {
    const provider = isLlmProviderKind(llmProvider.value) ? llmProvider.value : "openai";
    providerBaseUrl.value = getDefaultLlmBaseUrl(provider);
    providerModel.value = getDefaultLlmModel(provider);
    syncProviderFieldPolicy();
  });
}

function renderShell() {
  appRoot.innerHTML = `
    <main class="page">
      <section class="hero">
        <h1>${ui("optionsTitle")}</h1>
        <p>${ui("optionsHeroDescription")}</p>
      </section>
      <section class="grid">
        <section class="panel">
          <h2>${ui("optionsDefaultKnownTopN")}</h2>
          <div class="rank-controls">
            <div class="rank-header">
              <span class="muted">${ui("optionsCurrentThreshold")}</span>
              <strong class="rank-value" id="rankValue">2500</strong>
            </div>
            <input id="rankRange" type="range" min="0" max="10000" step="100" value="2500" />
            <input id="rankNumber" type="number" min="0" max="10000" step="100" value="2500" />
            <p class="muted">${ui("optionsThresholdDescription")}</p>
          </div>
        </section>
        <section class="panel">
          <h2>${ui("optionsLearningOverview")}</h2>
          <div class="stats">
            <div class="stat"><span>${ui("labelInsideDefaultThreshold")}</span><strong id="baseKnownCount">2500</strong></div>
            <div class="stat"><span>${ui("labelEstimatedTotalKnown")}</span><strong id="totalKnownCount">2500</strong></div>
            <div class="stat"><span>${ui("labelExtraKnown")}</span><strong id="extraKnownCount">0</strong></div>
            <div class="stat"><span>${ui("labelIgnoredWords")}</span><strong id="ignoredCount">0</strong></div>
          </div>
          <p class="muted">${ui("optionsExtraKnownDescription")}</p>
        </section>
      </section>
      <section class="panel">
        <h2>${ui("optionsSearchManageWords")}</h2>
        <label class="muted" for="wordReviewTrigger">${ui("optionsWordReviewTrigger")}</label>
        <select id="wordReviewTrigger">
          <option value="doubleClick">${ui("optionsWordReviewTriggerDoubleClick")}</option>
          <option value="selection">${ui("optionsWordReviewTriggerSelection")}</option>
        </select>
        <p class="muted">${ui("optionsWordReviewTriggerDescription")}</p>
        <p class="settings-status" role="status" aria-live="polite"></p>
        <input id="searchInput" type="search" placeholder="${ui("optionsSearchPlaceholder")}" />
        <p class="muted">${ui("optionsSearchDescription")}</p>
        <div class="search-results" id="searchResults"></div>
      </section>
      <section class="panel">
        <h2>${ui("optionsTranslationSettings")}</h2>
        <p class="muted">${ui("optionsTranslationDescription")}</p>
        <div class="rank-controls">
          <div class="profile-toolbar">
            <label class="muted" for="profileSelect">${ui("optionsActiveProfile")}</label>
            <select id="profileSelect">${renderProfileOptionsMarkup()}</select>
            <div class="profile-actions">
              <button class="secondary" id="newProfileButton" type="button">${ui("optionsNewProfile")}</button>
              <button class="secondary" id="duplicateProfileButton" type="button">${ui("optionsDuplicateProfile")}</button>
              <button class="secondary" id="renameProfileButton" type="button">${ui("optionsRenameProfile")}</button>
              <button class="secondary" id="deleteProfileButton" type="button"${translatorSettingsState.profiles.length <= 1 ? " disabled" : ""}>${ui("optionsDeleteProfile")}</button>
            </div>
          </div>
          <label class="muted" for="learnerLanguageCode">${ui("optionsLearnerLanguage")}</label>
          <select id="learnerLanguageCode">${renderLanguageOptionsMarkup()}</select>
          <label class="muted" for="defaultTranslationProvider">${ui("optionsDefaultTranslationProvider")}</label>
          <select id="defaultTranslationProvider">
            <option value="google">${ui("optionsDefaultTranslationProviderGoogle")}</option>
            <option value="llm">${ui("optionsDefaultTranslationProviderLlm")}</option>
          </select>
          <label class="muted" for="llmProvider">${ui("optionsLlmProvider")}</label>
          <select id="llmProvider">${renderLlmProviderOptionsMarkup()}</select>
          <label class="muted" for="providerBaseUrl">${ui("optionsProviderBaseUrl")}</label>
          <input id="providerBaseUrl" type="text" placeholder="${ui("optionsProviderBaseUrl")}" />
          <label class="muted" for="providerModel">${ui("optionsProviderModel")}</label>
          <input id="providerModel" type="text" placeholder="${ui("optionsProviderModel")}" />
          <label class="muted" for="providerApiKey">${ui("optionsProviderApiKey")}</label>
          <input id="providerApiKey" type="password" placeholder="${ui("optionsApiKeyPlaceholder")}" />
          <p class="muted" id="providerHint"></p>
          <select id="llmDisplayMode">
            <option value="word">${ui("optionsDisplayModeWord")}</option>
            <option value="sentence">${ui("optionsDisplayModeSentence")}</option>
            <option value="english">${ui("optionsDisplayModeEnglish")}</option>
          </select>
          <div class="cache-settings">
            <input id="cacheDurationValue" type="number" min="1" step="1" placeholder="${ui("optionsCacheDurationPlaceholder")}" />
            <select id="cacheDurationUnit">
              <option value="minutes">${ui("unitMinutes")}</option>
              <option value="hours">${ui("unitHours")}</option>
            </select>
          </div>
          <p class="muted">${ui("optionsCacheDescription")}</p>
          <label class="muted"><input id="fallbackToGoogle" type="checkbox" checked /> ${ui("optionsFallbackToGoogle")}</label>
          <div class="word-actions">
            <button class="primary" id="saveTranslatorButton">${ui("optionsSaveTranslationSettings")}</button>
          </div>
          <p class="settings-status" role="status" aria-live="polite"></p>
        </div>
      </section>
      <section class="grid">
        <section class="panel">
          <h2>${ui("optionsManualKnownWords")}</h2>
          <div class="tag-list" id="masteredList"></div>
        </section>
        <section class="panel">
          <h2>${ui("optionsIgnoredWordsHeading")}</h2>
          <div class="tag-list" id="ignoredList"></div>
        </section>
      </section>
      <section class="panel">
        <h2>${ui("optionsDataBackup")}</h2>
        <p class="muted">${ui("optionsDataBackupDescription")}</p>
        <p class="muted">${ui("optionsDataBackupNoSecrets")}</p>
        <div class="word-actions">
          <button class="primary" id="exportDataButton" type="button">${ui("optionsExportData")}</button>
          <button class="secondary" id="importDataButton" type="button">${ui("optionsImportData")}</button>
          <input id="importDataInput" type="file" accept="application/json,.json" hidden />
        </div>
        <p class="settings-status" role="status" aria-live="polite"></p>
      </section>
      <section class="panel">
        <h2>${ui("optionsReset")}</h2>
        <p class="muted">${ui("optionsResetDescription")}</p>
        <button class="danger" id="clearButton">${ui("optionsResetButton")}</button>
      </section>
    </main>
  `;

  assignRefs();
  bindEvents();
}

async function boot() {
  settings = await getSettings();
  setTranslatorSettingsState(await getTranslatorSettingsState());
  renderShell();
  renderAll();
}

void boot();
