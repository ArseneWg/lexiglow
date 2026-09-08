import "./styles.css";

import { t } from "../shared/i18n";
import {
  countExtraMastered,
  countTotalKnown,
  updateKnownBaseRank,
} from "../shared/settings";
import { getSettings, getTranslatorSettings, saveSettings } from "../shared/storage";
import { DEFAULT_TRANSLATOR_SETTINGS } from "../shared/translator";
import type { TranslatorSettings, UserSettings } from "../shared/types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing popup root");
}

const appRoot = app;

let settings: UserSettings;
let translatorSettings: TranslatorSettings = DEFAULT_TRANSLATOR_SETTINGS;

let totalKnownCount!: HTMLElement;
let extraKnownCount!: HTMLElement;
let knownBaseRank!: HTMLElement;
let ignoredCount!: HTMLElement;
let rankLabel!: HTMLElement;
let rankRange!: HTMLInputElement;
let rankNumber!: HTMLInputElement;
let openOptions!: HTMLButtonElement;
let refreshPage!: HTMLButtonElement;

function ui(key: Parameters<typeof t>[1], variables?: Record<string, string | number>): string {
  return t(translatorSettings.learnerLanguageCode, key, variables);
}

function assignRefs() {
  totalKnownCount = document.querySelector<HTMLElement>("#totalKnownCount")!;
  extraKnownCount = document.querySelector<HTMLElement>("#extraKnownCount")!;
  knownBaseRank = document.querySelector<HTMLElement>("#knownBaseRank")!;
  ignoredCount = document.querySelector<HTMLElement>("#ignoredCount")!;
  rankLabel = document.querySelector<HTMLElement>("#rankLabel")!;
  rankRange = document.querySelector<HTMLInputElement>("#rankRange")!;
  rankNumber = document.querySelector<HTMLInputElement>("#rankNumber")!;
  openOptions = document.querySelector<HTMLButtonElement>("#openOptions")!;
  refreshPage = document.querySelector<HTMLButtonElement>("#refreshPage")!;
}

function renderShell() {
  appRoot.innerHTML = `
    <main class="panel">
      <section class="hero">
        <h1>LexiGlow</h1>
        <p>${ui("popupHeroDescription")}</p>
      </section>
      <section class="stats">
        <div class="stat"><span>${ui("labelTotalKnown")}</span><strong id="totalKnownCount">2500</strong></div>
        <div class="stat"><span>${ui("labelExtraKnown")}</span><strong id="extraKnownCount">0</strong></div>
        <div class="stat"><span>${ui("labelDefaultThreshold")}</span><strong id="knownBaseRank">2500</strong></div>
        <div class="stat"><span>${ui("labelIgnoredWords")}</span><strong id="ignoredCount">0</strong></div>
      </section>
      <section class="controls">
        <div class="controls-header">
          <span class="muted">${ui("optionsDefaultKnownTopN")}</span>
          <strong id="rankLabel">2500</strong>
        </div>
        <input id="rankRange" type="range" min="0" max="10000" step="100" value="2500" />
        <input id="rankNumber" type="number" min="0" max="10000" step="100" value="2500" />
        <p class="muted">${ui("popupRefreshHint")}</p>
      </section>
      <section class="actions">
        <button class="primary" id="openOptions">${ui("popupOpenFullSettings")}</button>
        <button class="secondary" id="refreshPage">${ui("popupRefreshCurrentPage")}</button>
      </section>
    </main>
  `;
}

function render() {
  const rank = String(settings.knownBaseRank);
  rankLabel.textContent = rank;
  knownBaseRank.textContent = rank;
  totalKnownCount.textContent = String(countTotalKnown(settings));
  extraKnownCount.textContent = String(countExtraMastered(settings));
  ignoredCount.textContent = String(settings.ignoredWords.length);
  rankRange.value = rank;
  rankNumber.value = rank;
}

async function persist(nextSettings: UserSettings) {
  settings = nextSettings;
  await saveSettings(settings);
  render();
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab.id) {
    await chrome.tabs.reload(tab.id);
  }
}

function bindEvents() {
  rankRange.addEventListener("input", async () => {
    await persist(updateKnownBaseRank(settings, Number(rankRange.value)));
  });

  rankNumber.addEventListener("change", async () => {
    await persist(updateKnownBaseRank(settings, Number(rankNumber.value)));
  });

  openOptions.addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });

  refreshPage.addEventListener("click", async () => {
    await refreshActiveTab();
    window.close();
  });
}

async function boot() {
  [settings, translatorSettings] = await Promise.all([
    getSettings(),
    getTranslatorSettings(),
  ]);
  renderShell();
  assignRefs();
  bindEvents();
  render();
}

void boot();
