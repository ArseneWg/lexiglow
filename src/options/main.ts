import "./styles.css";

import { t } from "../shared/i18n";
import { LEXICON_WORDS, lookupRank, resolveLookupLemma } from "../shared/lexicon";
import type { RuntimeMessage, TranslatorSettingsResponse } from "../shared/messages";
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
} from "../shared/settings";
import { getSettings, getTranslatorSettings, saveSettings } from "../shared/storage";
import {
  DEFAULT_TRANSLATOR_SETTINGS,
  getDefaultLlmBaseUrl,
  getDefaultLlmModel,
  LEARNER_LANGUAGE_OPTIONS,
} from "../shared/translator";
import type { TranslatorSettings, UserSettings } from "../shared/types";

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

let rankValue!: HTMLElement;
let rankRange!: HTMLInputElement;
let rankNumber!: HTMLInputElement;
let baseKnownCount!: HTMLElement;
let totalKnownCount!: HTMLElement;
let extraKnownCount!: HTMLElement;
let ignoredCount!: HTMLElement;
let searchInput!: HTMLInputElement;
let searchResults!: HTMLElement;
let learnerLanguageCode!: HTMLSelectElement;
let defaultTranslationProvider!: HTMLSelectElement;
let llmProvider!: HTMLSelectElement;
let providerBaseUrl!: HTMLInputElement;
let providerModel!: HTMLInputElement;
let providerApiKey!: HTMLInputElement;
let llmDisplayMode!: HTMLSelectElement;
let cacheDurationValue!: HTMLInputElement;
let cacheDurationUnit!: HTMLSelectElement;
let fallbackToGoogle!: HTMLInputElement;
let saveTranslatorButton!: HTMLButtonElement;
let masteredList!: HTMLElement;
let ignoredList!: HTMLElement;
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

function assignRefs() {
  rankValue = document.querySelector<HTMLElement>("#rankValue")!;
  rankRange = document.querySelector<HTMLInputElement>("#rankRange")!;
  rankNumber = document.querySelector<HTMLInputElement>("#rankNumber")!;
  baseKnownCount = document.querySelector<HTMLElement>("#baseKnownCount")!;
  totalKnownCount = document.querySelector<HTMLElement>("#totalKnownCount")!;
  extraKnownCount = document.querySelector<HTMLElement>("#extraKnownCount")!;
  ignoredCount = document.querySelector<HTMLElement>("#ignoredCount")!;
  searchInput = document.querySelector<HTMLInputElement>("#searchInput")!;
  searchResults = document.querySelector<HTMLElement>("#searchResults")!;
  learnerLanguageCode = document.querySelector<HTMLSelectElement>("#learnerLanguageCode")!;
  defaultTranslationProvider = document.querySelector<HTMLSelectElement>("#defaultTranslationProvider")!;
  llmProvider = document.querySelector<HTMLSelectElement>("#llmProvider")!;
  providerBaseUrl = document.querySelector<HTMLInputElement>("#providerBaseUrl")!;
  providerModel = document.querySelector<HTMLInputElement>("#providerModel")!;
  providerApiKey = document.querySelector<HTMLInputElement>("#providerApiKey")!;
  llmDisplayMode = document.querySelector<HTMLSelectElement>("#llmDisplayMode")!;
  cacheDurationValue = document.querySelector<HTMLInputElement>("#cacheDurationValue")!;
  cacheDurationUnit = document.querySelector<HTMLSelectElement>("#cacheDurationUnit")!;
  fallbackToGoogle = document.querySelector<HTMLInputElement>("#fallbackToGoogle")!;
  saveTranslatorButton = document.querySelector<HTMLButtonElement>("#saveTranslatorButton")!;
  masteredList = document.querySelector<HTMLElement>("#masteredList")!;
  ignoredList = document.querySelector<HTMLElement>("#ignoredList")!;
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

function renderAll() {
  setRankInputs(settings.knownBaseRank);
  totalKnownCount.textContent = String(countTotalKnown(settings));
  extraKnownCount.textContent = String(countExtraMastered(settings));
  ignoredCount.textContent = String(settings.ignoredWords.length);
  learnerLanguageCode.value = translatorSettings.learnerLanguageCode;
  defaultTranslationProvider.value = translatorSettings.defaultTranslationProvider;
  llmProvider.value = translatorSettings.llmProvider;
  providerBaseUrl.value = translatorSettings.providerBaseUrl;
  providerModel.value = translatorSettings.providerModel;
  providerApiKey.value = translatorSettings.apiKey;
  llmDisplayMode.value = translatorSettings.llmDisplayMode;
  cacheDurationValue.value = String(translatorSettings.cacheDurationValue);
  cacheDurationUnit.value = translatorSettings.cacheDurationUnit;
  fallbackToGoogle.checked = translatorSettings.fallbackToGoogle;
  renderSearch();
  renderMasteredList();
  renderIgnoredList();
}

async function persistSettings(nextSettings: UserSettings) {
  settings = nextSettings;
  await saveSettings(settings);
  renderAll();
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

  clearButton.addEventListener("click", async () => {
    await persistSettings(clearLearningProgress(settings));
  });

  saveTranslatorButton.addEventListener("click", async () => {
    const response = await runtimeSend<TranslatorSettingsResponse>({
      type: "SAVE_TRANSLATOR_SETTINGS",
      payload: {
        settings: {
          llmProvider:
            llmProvider.value === "gemini"
              ? "gemini"
              : llmProvider.value === "claude"
                ? "claude"
                : "openai",
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
        },
      },
    });

    if (response.ok && response.settings) {
      translatorSettings = response.settings;
      renderShell();
      renderAll();
    }
  });

  llmProvider.addEventListener("change", () => {
    const provider =
      llmProvider.value === "gemini"
        ? "gemini"
        : llmProvider.value === "claude"
          ? "claude"
          : "openai";
    providerBaseUrl.value = getDefaultLlmBaseUrl(provider);
    providerModel.value = getDefaultLlmModel(provider);
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
        <input id="searchInput" type="search" placeholder="${ui("optionsSearchPlaceholder")}" />
        <p class="muted">${ui("optionsSearchDescription")}</p>
        <div class="search-results" id="searchResults"></div>
      </section>
      <section class="panel">
        <h2>${ui("optionsTranslationSettings")}</h2>
        <p class="muted">${ui("optionsTranslationDescription")}</p>
        <div class="rank-controls">
          <label class="muted" for="learnerLanguageCode">${ui("optionsLearnerLanguage")}</label>
          <select id="learnerLanguageCode">${renderLanguageOptionsMarkup()}</select>
          <label class="muted" for="defaultTranslationProvider">${ui("optionsDefaultTranslationProvider")}</label>
          <select id="defaultTranslationProvider">
            <option value="google">${ui("optionsDefaultTranslationProviderGoogle")}</option>
            <option value="llm">${ui("optionsDefaultTranslationProviderLlm")}</option>
          </select>
          <select id="llmProvider">
            <option value="openai">OpenAI / Compatible</option>
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
          </select>
          <input id="providerBaseUrl" type="text" placeholder="Base URL" />
          <input id="providerModel" type="text" placeholder="Model" />
          <input id="providerApiKey" type="password" placeholder="${ui("optionsApiKeyPlaceholder")}" />
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
  translatorSettings = await getTranslatorSettings();
  renderShell();
  renderAll();
}

void boot();
