import "./styles.css";

import {
  countExtraMastered,
  countTotalKnown,
  updateKnownBaseRank,
} from "../shared/settings";
import { getSettings, saveSettings } from "../shared/storage";
import type { UserSettings } from "../shared/types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing popup root");
}

app.innerHTML = `
  <main class="panel">
    <section class="hero">
      <h1>WordWise</h1>
      <p>带点状下划线的词表示当前会触发翻译。你可以在这里快速调整默认已掌握词数。</p>
    </section>
    <section class="stats">
      <div class="stat"><span>总已掌握</span><strong id="totalKnownCount">2500</strong></div>
      <div class="stat"><span>额外已掌握</span><strong id="extraKnownCount">0</strong></div>
      <div class="stat"><span>默认阈值</span><strong id="knownBaseRank">2500</strong></div>
      <div class="stat"><span>永不翻译</span><strong id="ignoredCount">0</strong></div>
    </section>
    <section class="controls">
      <div class="controls-header">
        <span class="muted">默认已掌握前 N 词</span>
        <strong id="rankLabel">2500</strong>
      </div>
      <input id="rankRange" type="range" min="0" max="10000" step="100" value="2500" />
      <input id="rankNumber" type="number" min="0" max="10000" step="100" value="2500" />
      <p class="muted">调整后，页面里的虚线提示会自动刷新。</p>
    </section>
    <section class="actions">
      <button class="primary" id="openOptions">打开完整设置</button>
      <button class="secondary" id="refreshPage">刷新当前页面</button>
    </section>
  </main>
`;

const totalKnownCount = document.querySelector<HTMLElement>("#totalKnownCount")!;
const extraKnownCount = document.querySelector<HTMLElement>("#extraKnownCount")!;
const knownBaseRank = document.querySelector<HTMLElement>("#knownBaseRank")!;
const ignoredCount = document.querySelector<HTMLElement>("#ignoredCount")!;
const rankLabel = document.querySelector<HTMLElement>("#rankLabel")!;
const rankRange = document.querySelector<HTMLInputElement>("#rankRange")!;
const rankNumber = document.querySelector<HTMLInputElement>("#rankNumber")!;
const openOptions = document.querySelector<HTMLButtonElement>("#openOptions")!;
const refreshPage = document.querySelector<HTMLButtonElement>("#refreshPage")!;

let settings: UserSettings;

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

async function boot() {
  settings = await getSettings();
  render();
}

void boot();
