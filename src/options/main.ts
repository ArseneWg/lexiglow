import "./styles.css";

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
import { getSettings, saveSettings } from "../shared/storage";
import { DEFAULT_TRANSLATOR_SETTINGS } from "../shared/translator";
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

app.innerHTML = `
  <main class="page">
    <section class="hero">
      <h1>WordWise 设置</h1>
      <p>设置默认已掌握高频词数量，管理你手工掌握的单词和永不翻译词。页面正文不会被插件改写，翻译只以悬浮层显示。</p>
    </section>
    <section class="grid">
      <section class="panel">
        <h2>默认已掌握前 N 词</h2>
        <div class="rank-controls">
          <div class="rank-header">
            <span class="muted">当前阈值</span>
            <strong class="rank-value" id="rankValue">2500</strong>
          </div>
          <input id="rankRange" type="range" min="0" max="10000" step="100" value="2500" />
          <input id="rankNumber" type="number" min="0" max="10000" step="100" value="2500" />
          <p class="muted">排名小于等于该数值的词默认视为已掌握。你也可以对单词做单独覆盖。</p>
        </div>
      </section>
      <section class="panel">
        <h2>学习概况</h2>
        <div class="stats">
          <div class="stat"><span>当前默认阈值内</span><strong id="baseKnownCount">2500</strong></div>
          <div class="stat"><span>预计总已掌握</span><strong id="totalKnownCount">2500</strong></div>
          <div class="stat"><span>额外已掌握</span><strong id="extraKnownCount">0</strong></div>
          <div class="stat"><span>永不翻译</span><strong id="ignoredCount">0</strong></div>
        </div>
        <p class="muted">“额外已掌握”会随着你在网页上点击“已掌握”持续增长。</p>
      </section>
    </section>
    <section class="panel">
      <h2>搜索和管理词</h2>
      <input id="searchInput" type="search" placeholder="输入单词，如 running / chatgpt" />
      <p class="muted">可以把词设为已掌握、未掌握，或加入永不翻译列表。</p>
      <div class="search-results" id="searchResults"></div>
    </section>
    <section class="panel">
      <h2>LLM 翻译设置</h2>
      <p class="muted">页面默认先显示 Google 单词翻译；当你手动点 LLM 时，会结合句子语境给出更好的结果。你可以选择只显示单词释义，或额外显示整句翻译 / 英英解释。API Key 只保存在当前浏览器本地，不会进入 GitHub 仓库。</p>
      <div class="rank-controls">
        <input id="providerBaseUrl" type="text" placeholder="Base URL" />
        <input id="providerModel" type="text" placeholder="Model" />
        <input id="providerApiKey" type="password" placeholder="API Key（仅本地保存）" />
        <select id="llmDisplayMode">
          <option value="word">只显示单词翻译</option>
          <option value="sentence">显示单词翻译 + 整句翻译</option>
          <option value="english">显示单词翻译 + 英英解释</option>
        </select>
        <label class="muted"><input id="fallbackToGoogle" type="checkbox" checked /> 调用失败时自动回退 Google</label>
        <div class="word-actions">
          <button class="primary" id="saveTranslatorButton">保存翻译设置</button>
        </div>
      </div>
    </section>
    <section class="grid">
      <section class="panel">
        <h2>手工已掌握</h2>
        <div class="tag-list" id="masteredList"></div>
      </section>
      <section class="panel">
        <h2>永不翻译</h2>
        <div class="tag-list" id="ignoredList"></div>
      </section>
    </section>
    <section class="panel">
      <h2>清理</h2>
      <p class="muted">清空个人学习进度会保留当前阈值，但移除手工已掌握和永不翻译记录。</p>
      <button class="danger" id="clearButton">清空个人学习进度</button>
    </section>
  </main>
`;

const rankValue = document.querySelector<HTMLElement>("#rankValue")!;
const rankRange = document.querySelector<HTMLInputElement>("#rankRange")!;
const rankNumber = document.querySelector<HTMLInputElement>("#rankNumber")!;
const baseKnownCount = document.querySelector<HTMLElement>("#baseKnownCount")!;
const totalKnownCount = document.querySelector<HTMLElement>("#totalKnownCount")!;
const extraKnownCount = document.querySelector<HTMLElement>("#extraKnownCount")!;
const ignoredCount = document.querySelector<HTMLElement>("#ignoredCount")!;
const searchInput = document.querySelector<HTMLInputElement>("#searchInput")!;
const searchResults = document.querySelector<HTMLElement>("#searchResults")!;
const providerBaseUrl = document.querySelector<HTMLInputElement>("#providerBaseUrl")!;
const providerModel = document.querySelector<HTMLInputElement>("#providerModel")!;
const providerApiKey = document.querySelector<HTMLInputElement>("#providerApiKey")!;
const llmDisplayMode = document.querySelector<HTMLSelectElement>("#llmDisplayMode")!;
const fallbackToGoogle = document.querySelector<HTMLInputElement>("#fallbackToGoogle")!;
const saveTranslatorButton = document.querySelector<HTMLButtonElement>("#saveTranslatorButton")!;
const masteredList = document.querySelector<HTMLElement>("#masteredList")!;
const ignoredList = document.querySelector<HTMLElement>("#ignoredList")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clearButton")!;

let settings: UserSettings;
let translatorSettings: TranslatorSettings = DEFAULT_TRANSLATOR_SETTINGS;

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
    labels.push(`<span class="pill">永不翻译</span>`);
  } else if (flags.isKnown) {
    labels.push(`<span class="pill">已掌握</span>`);
  } else {
    labels.push(`<span class="pill">待学习</span>`);
  }

  if (rank !== null) {
    labels.push(`<span class="pill">#${rank}</span>`);
  } else {
    labels.push(`<span class="pill">词表外</span>`);
  }

  if (isBuiltinIgnoredWord(lemma)) {
    labels.push(`<span class="pill">内置忽略</span>`);
  }

  return labels.join(" ");
}

function renderSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.innerHTML = `<p class="muted">输入一个英文单词即可开始管理。</p>`;
    return;
  }

  const entries = searchLexicon(query);

  if (!entries.length) {
    searchResults.innerHTML = `<p class="muted">没有找到可管理的单词。</p>`;
    return;
  }

  searchResults.innerHTML = entries
    .map((entry) => {
      const flags = resolveWordFlags(entry.lemma, entry.rank, settings, entry.lemma);
      const knownActionLabel = flags.isKnown ? "设为未掌握" : "设为已掌握";
      const ignoreActionLabel =
        flags.isIgnored && !isBuiltinIgnoredWord(entry.lemma) ? "取消忽略" : "永不翻译";

      return `
        <div class="word-row" data-lemma="${entry.lemma}" data-rank="${entry.rank ?? ""}">
          <div class="word-row-header">
            <strong>${entry.lemma}</strong>
            <div>${wordStatusMarkup(entry.lemma, entry.rank)}</div>
          </div>
          <div class="word-actions">
            ${
              !flags.isIgnored
                ? `<button class="primary" data-action="toggle-known">${knownActionLabel}</button>`
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
    masteredList.innerHTML = `<p class="muted">还没有手工掌握的单词。</p>`;
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
            <button class="secondary" data-action="remove-mastered">设为未掌握</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderIgnoredList() {
  if (!settings.ignoredWords.length) {
    ignoredList.innerHTML = `<p class="muted">还没有手工忽略的单词。</p>`;
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
            <button class="secondary" data-action="remove-ignored">取消忽略</button>
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
  providerBaseUrl.value = translatorSettings.providerBaseUrl;
  providerModel.value = translatorSettings.providerModel;
  providerApiKey.value = translatorSettings.apiKey;
  llmDisplayMode.value = translatorSettings.llmDisplayMode;
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

async function persistTranslatorSettings(nextSettings: TranslatorSettings) {
  const response = await runtimeSend<TranslatorSettingsResponse>({
    type: "SAVE_TRANSLATOR_SETTINGS",
    payload: {
      settings: nextSettings,
    },
  });

  if (response.ok && response.settings) {
    translatorSettings = response.settings;
    renderAll();
  }
}

rankRange.addEventListener("input", async () => {
  const value = Number(rankRange.value);
  await persistSettings(updateKnownBaseRank(settings, value));
});

rankNumber.addEventListener("change", async () => {
  const value = Number(rankNumber.value);
  await persistSettings(updateKnownBaseRank(settings, value));
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
  const rank = lookupRank(lemma);
  await persistSettings(setWordUnmastered(settings, lemma, rank));
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
  await persistTranslatorSettings({
    providerBaseUrl: providerBaseUrl.value,
    providerModel: providerModel.value,
    apiKey: providerApiKey.value,
    llmDisplayMode:
      llmDisplayMode.value === "sentence"
        ? "sentence"
        : llmDisplayMode.value === "english"
          ? "english"
          : "word",
    fallbackToGoogle: fallbackToGoogle.checked,
  });
});

async function boot() {
  settings = await getSettings();
  const translatorResponse = await runtimeSend<TranslatorSettingsResponse>({
    type: "GET_TRANSLATOR_SETTINGS",
  });
  translatorSettings = translatorResponse.settings ?? DEFAULT_TRANSLATOR_SETTINGS;
  renderAll();
}

void boot();
