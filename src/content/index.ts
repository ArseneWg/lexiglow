import { STORAGE_TRANSLATOR_SETTINGS_KEY } from "../shared/constants";
import { t } from "../shared/i18n";
import { lookupRank, resolveLookupLemma } from "../shared/lexicon";
import {
  getDisplayClauseBlocks,
} from "../shared/sentenceAnalysisDisplay";
import type {
  LookupWordResponse,
  PronunciationLookupResponse,
  PronunciationResponse,
  RuntimeMessage,
  SentenceAnalysisResponse,
  SelectionTranslationResponse,
  SettingsResponse,
  TranslationProviderChoice,
} from "../shared/messages";
import { DEFAULT_SETTINGS, looksLikeContextualSpecialTerm, resolveWordFlags } from "../shared/settings";
import { getSettings, getTranslatorSettings } from "../shared/storage";
import {
  countEnglishWords,
  createEnglishTokenMatcher,
  extractWordAtOffset,
  isEnglishSelectionText,
  isSingleEnglishWord,
  normalizeSelectionText,
  normalizeSingleEnglishWord,
} from "../shared/word";
import type {
  LexiconLookupResult,
  PronunciationAccent,
  PronunciationResult,
  SentenceAnalysisResult,
  SupportedLearnerLanguageCode,
  UserSettings,
} from "../shared/types";

const HOVER_DELAY_MS = 320;
const HIDE_DELAY_MS = 1200;
const HIGHLIGHT_NAME = "wordwise-pending";
const HIGHLIGHT_SCAN_LIMIT = 1200;
const SELECTION_TRIGGER_DEBOUNCE_MS = 40;
let currentLearnerLanguageCode: SupportedLearnerLanguageCode = "zh-CN";
let currentDefaultTranslationProvider: TranslationProviderChoice = "google";
let activeDisplayedTranslationProvider: TranslationProviderChoice = "google";

function ui(key: Parameters<typeof t>[1], variables?: Record<string, string | number>): string {
  return t(currentLearnerLanguageCode, key, variables);
}

function normalizeDisplayedTranslationProvider(provider?: string): TranslationProviderChoice {
  return provider === "llm" ? "llm" : "google";
}

function getAlternateTranslationProvider(provider: TranslationProviderChoice): TranslationProviderChoice {
  return provider === "llm" ? "google" : "llm";
}

const TOOLTIP_STYLE = `
  :host {
    all: initial;
  }
  .wordwise-card {
    --wordwise-ui-font: "SF Pro Text", "SF Pro SC", "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei UI", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
    --wordwise-translation-font: "SF Pro Display", "SF Pro Text", "SF Pro SC", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei UI", "Segoe UI", -apple-system, BlinkMacSystemFont,
      sans-serif;
    --wordwise-selection-translation-size: 16.4px;
    --wordwise-selection-secondary-size: 13px;
    --wordwise-selection-line-height: 1.74;
    position: fixed;
    min-width: 220px;
    max-width: min(344px, calc(100vw - 24px));
    padding: 14px 15px 13px;
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 252, 245, 0.96);
    box-shadow:
      0 12px 30px rgba(15, 23, 42, 0.1),
      0 2px 8px rgba(15, 23, 42, 0.04);
    color: #172033;
    font-family: var(--wordwise-ui-font);
    backdrop-filter: blur(12px);
    pointer-events: auto;
  }
  .wordwise-close {
    position: absolute;
    top: 9px;
    right: 9px;
    z-index: 3;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.06);
    color: #64748b;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
  }
  .wordwise-close[data-visible="true"] {
    display: inline-flex;
  }
  .wordwise-close:hover {
    background: rgba(15, 23, 42, 0.14);
    color: #1f2937;
  }
  .wordwise-card[data-mode="analysis"] {
    max-width: 580px;
    max-height: min(72vh, 780px);
    overflow-y: auto;
  }
  .wordwise-card[data-layout="selection"][data-mode="word"] {
    min-width: min(320px, calc(100vw - 24px));
    max-width: min(496px, calc(100vw - 24px));
  }
  .wordwise-card[data-mode="word"] {
    padding-bottom: 9px;
  }
  .wordwise-word-view[data-visible="false"],
  .wordwise-analysis-view[data-visible="false"] {
    display: none;
  }
  .wordwise-word-view {
    display: grid;
    gap: 11px;
  }
  .wordwise-word-view[data-layout="selection"] {
    gap: 8px;
  }
  .wordwise-surface {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.25;
    margin-bottom: 0;
    color: #10213a;
    letter-spacing: 0.01em;
  }
  .wordwise-surface-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .wordwise-surface-pos {
    display: none;
    font-size: 10.5px;
    line-height: 1;
    font-weight: 600;
    color: #7b8798;
    letter-spacing: 0.02em;
  }
  .wordwise-surface-pos[data-visible="true"] {
    display: inline-flex;
  }
  .wordwise-pronunciation {
    display: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin: 0;
  }
  .wordwise-pronunciation[data-visible="true"] {
    display: grid;
  }
  .wordwise-pronunciation-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
    padding: 5px 9px;
    border-radius: 11px;
    border: 1px solid rgba(148, 163, 184, 0.12);
    background: rgba(248, 250, 252, 0.48);
    color: #334155;
    font-size: 11px;
    line-height: 1;
  }
  .wordwise-pronunciation-text {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: #475569;
    white-space: nowrap;
    flex-wrap: nowrap;
  }
  .wordwise-pronunciation-label {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    flex: 0 0 auto;
  }
  .wordwise-pronunciation-ipa {
    font-size: 11px;
    font-weight: 600;
    color: #7c6f45;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-all;
    line-height: 1;
  }
  .wordwise-pronunciation-action {
    border: 0;
    background: transparent;
    color: #ea580c;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    flex: 0 0 auto;
  }
  .wordwise-pronunciation-action:hover {
    color: #c2410c;
  }
  .wordwise-pronunciation-action[data-playing="true"] {
    color: #dc2626;
  }
  .wordwise-pronunciation-action svg {
    width: 13px;
    height: 13px;
    display: block;
  }
  .wordwise-translation {
    margin: 0;
    display: none;
    opacity: 1;
    transform: translateY(0);
    filter: none;
    transition:
      opacity 180ms ease,
      transform 180ms ease,
      filter 180ms ease;
  }
  .wordwise-translation[data-visible="true"] {
    display: block;
    padding: 11px 12px 10px;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(250, 247, 239, 0.9));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.68),
      0 8px 20px rgba(148, 163, 184, 0.08);
  }
  .wordwise-translation[data-compact="true"][data-visible="true"] {
    padding-top: 10px;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-translation[data-visible="true"] {
    margin-top: 4px;
    padding: 18px 18px 14px;
    border-radius: 20px;
    border-color: rgba(198, 168, 118, 0.22);
    background:
      radial-gradient(circle at top right, rgba(255, 236, 199, 0.28), transparent 28%),
      linear-gradient(145deg, rgba(255, 255, 255, 0.985), rgba(250, 246, 239, 0.96) 52%, rgba(243, 237, 228, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.84),
      inset 0 -1px 0 rgba(198, 168, 118, 0.06),
      0 12px 28px rgba(148, 163, 184, 0.12);
  }
  .wordwise-translation[data-transition="loading"] {
    opacity: 0.68;
    filter: saturate(0.92);
  }
  .wordwise-translation[data-transition="swap-out"] {
    opacity: 0.16;
    transform: translateY(5px);
    filter: saturate(0.9);
  }
  .wordwise-translation[data-transition="swap-in"] {
    opacity: 0;
    transform: translateY(5px);
    filter: saturate(0.94);
  }
  .wordwise-primary-translation {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 14.75px;
    line-height: 1.58;
    color: #33475f;
    font-weight: 520;
    letter-spacing: 0.002em;
  }
  .wordwise-primary-translation-text {
    color: inherit;
  }
  .wordwise-primary-translation-pos {
    display: none;
    font-size: 10.5px;
    line-height: 1;
    font-weight: 600;
    color: #7b8798;
    letter-spacing: 0.02em;
  }
  .wordwise-primary-translation-pos[data-visible="true"] {
    display: inline-flex;
  }
  .wordwise-translation[data-compact="true"] .wordwise-primary-translation {
    font-size: 15.25px;
    line-height: 1.44;
    color: #314256;
    font-weight: 540;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-primary-translation {
    display: grid;
    gap: 7px;
    font-size: var(--wordwise-selection-translation-size);
    line-height: var(--wordwise-selection-line-height);
    color: #203248;
    font-weight: 590;
    letter-spacing: 0.01em;
    text-wrap: pretty;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-primary-translation-text {
    display: block;
    font-family: var(--wordwise-translation-font);
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    color: inherit;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-primary-translation-pos[data-visible="true"] {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(207, 181, 136, 0.14);
    color: #7b6747;
    font-size: 10.5px;
    line-height: 1;
    letter-spacing: 0.03em;
  }
  .wordwise-secondary-translation {
    font-size: 12px;
    line-height: 1.6;
    color: #6f8094;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    display: none;
  }
  .wordwise-secondary-translation[data-visible="true"] {
    display: block;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-secondary-translation {
    margin-top: 13px;
    padding-top: 12px;
    font-family: var(--wordwise-ui-font);
    font-size: var(--wordwise-selection-secondary-size);
    line-height: 1.76;
    color: #607287;
    border-top-color: rgba(198, 168, 118, 0.18);
    text-wrap: pretty;
  }
  .wordwise-english-explanation {
    display: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
  }
  .wordwise-english-explanation[data-visible="true"] {
    display: block;
  }
  .wordwise-english-explanation-label {
    font-size: 11px;
    font-weight: 600;
    color: #7b8798;
    letter-spacing: 0.04em;
    margin-bottom: 3px;
  }
  .wordwise-english-explanation-text {
    font-size: 12px;
    line-height: 1.58;
    color: #66768b;
  }
  .wordwise-hint {
    font-size: 10.5px;
    line-height: 1.28;
    color: #929baa;
    margin: 0;
    text-align: right;
  }
  .wordwise-hint[data-kind="status"] {
    line-height: 1.12;
  }
  .wordwise-hint[data-visible="false"] {
    display: none;
  }
  .wordwise-hint[data-loading="true"]::after,
  .wordwise-analysis-status[data-loading="true"]::after {
    content: " …";
    display: inline-block;
    vertical-align: baseline;
    animation: wordwise-fade 1s ease-in-out infinite;
  }
  .wordwise-actions {
    position: relative;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin: 0;
  }
  .wordwise-action-indicator {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--wordwise-action-indicator-width, 78px);
    height: var(--wordwise-action-indicator-height, 30px);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.88),
      0 1px 2px rgba(15, 23, 42, 0.04),
      0 2px 6px rgba(148, 163, 184, 0.1);
    transform: translate3d(
      var(--wordwise-action-indicator-x, 0),
      var(--wordwise-action-indicator-y, 0),
      0
    );
    opacity: 0;
    pointer-events: none;
    transition:
      transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
      width 220ms cubic-bezier(0.22, 1, 0.36, 1),
      height 220ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 160ms ease;
  }
  .wordwise-action-indicator[data-visible="true"] {
    opacity: 1;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-actions {
    gap: 4px;
    margin-top: 2px;
    margin-left: 10px;
    padding: 3px;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.08);
    background:
      linear-gradient(180deg, rgba(239, 243, 248, 0.9), rgba(231, 237, 245, 0.84));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.68),
      inset 0 -1px 0 rgba(148, 163, 184, 0.06),
      0 2px 8px rgba(148, 163, 184, 0.04);
    width: fit-content;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-button {
    position: relative;
    z-index: 1;
    min-height: 28px;
    min-width: 74px;
    padding: 0 11px;
    border-radius: 9px;
    font-size: 10px;
    font-weight: 570;
    letter-spacing: -0.01em;
    color: #5d6d82;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-button--secondary {
    background: transparent;
    color: #627286;
    border-color: transparent;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-button:not(.wordwise-button--secondary) {
    color: #20324a;
    border-color: transparent;
    background: transparent;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-button:hover {
    transform: translateY(0);
    background: rgba(255, 255, 255, 0.48);
    border-color: transparent;
    color: #40526a;
  }
  .wordwise-word-view[data-layout="word"] .wordwise-button:not(.wordwise-button--secondary):hover {
    color: #18293f;
    border-color: transparent;
    background: transparent;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-actions {
    gap: 6px;
    margin-top: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    width: 100%;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-button {
    position: relative;
    z-index: 1;
    min-height: 30px;
    min-width: 84px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 580;
    letter-spacing: 0.01em;
    color: #53657a;
    background: rgba(255, 255, 255, 0.84);
    border-color: rgba(198, 168, 118, 0.16);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 1px 2px rgba(148, 163, 184, 0.06);
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-button--secondary {
    background: rgba(255, 255, 255, 0.84);
    color: #5c6f84;
    border-color: rgba(198, 168, 118, 0.14);
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-button:hover {
    transform: translateY(0);
    background: rgba(255, 255, 255, 0.96);
    border-color: rgba(198, 168, 118, 0.24);
    color: #38506b;
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-meta {
    justify-content: flex-start;
    gap: 6px;
    margin-top: 12px;
    padding-top: 11px;
    border-top-color: rgba(198, 168, 118, 0.15);
  }
  .wordwise-word-view[data-layout="selection"] .wordwise-hint {
    font-size: 11px;
    line-height: 1.35;
    color: #8b7353;
    letter-spacing: 0.02em;
    text-align: left;
  }
  .wordwise-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
  }
  .wordwise-meta .wordwise-hint {
    max-width: 100%;
  }
  .wordwise-translation .wordwise-meta {
    margin-bottom: 0;
  }
  .wordwise-meta-divider {
    display: none;
    color: #c3ccd7;
    font-size: 10px;
    line-height: 1;
    user-select: none;
  }
  .wordwise-hint[data-visible="true"] + .wordwise-meta-divider + .wordwise-rank:not(:empty) {
    display: inline-flex;
    align-items: center;
  }
  .wordwise-hint[data-loading="true"] + .wordwise-meta-divider,
  .wordwise-hint[data-loading="true"] + .wordwise-meta-divider + .wordwise-rank {
    display: none;
  }
  .wordwise-rank {
    font-size: 10.25px;
    line-height: 1.1;
    color: #96a0ae;
    letter-spacing: 0.01em;
    text-align: right;
  }
  .wordwise-rank[data-kind="status"] {
    font-size: 10.5px;
    line-height: 1.12;
    color: #929baa;
  }
  .wordwise-button {
    border: 1px solid transparent;
    border-radius: 999px;
    min-height: 30px;
    min-width: 88px;
    padding: 0 13px;
    background: #22324a;
    color: white;
    font-size: 10.75px;
    font-weight: 560;
    line-height: 1;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    transition:
      background-color 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease,
      transform 160ms ease;
  }
  .wordwise-button:hover {
    background: #1d2d44;
    transform: translateY(-1px);
  }
  .wordwise-button--secondary {
    background: rgba(255, 255, 255, 0.9);
    color: #24364d;
    border-color: rgba(148, 163, 184, 0.2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 1px 2px rgba(148, 163, 184, 0.08);
  }
  .wordwise-button--secondary:hover {
    background: rgba(255, 255, 255, 1);
    border-color: rgba(148, 163, 184, 0.28);
  }
  .wordwise-analysis-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .wordwise-analysis-title {
    font-size: 16px;
    font-weight: 700;
    color: #10213a;
    font-family: inherit;
  }
  .wordwise-analysis-status {
    font-size: 13px;
    line-height: 1.6;
    color: #6b7280;
    margin-bottom: 12px;
    font-family: inherit;
  }
  .wordwise-analysis-status:empty {
    display: none;
    margin-bottom: 0;
  }
  .wordwise-analysis-section {
    margin-bottom: 18px;
  }
  .wordwise-analysis-section--steps {
    margin-top: 2px;
    margin-bottom: 8px;
  }
  .wordwise-analysis-loading {
    display: none;
    margin-bottom: 14px;
    padding: 14px 15px;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background:
      linear-gradient(180deg, rgba(239, 246, 255, 0.62), rgba(255, 255, 255, 0.76));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.56),
      0 10px 24px rgba(148, 163, 184, 0.08);
  }
  .wordwise-analysis-loading[data-visible="true"] {
    display: block;
    animation: wordwise-analysis-loading-in 220ms ease-out both;
  }
  .wordwise-analysis-loading-title {
    font-size: 13px;
    line-height: 1.4;
    color: #24364d;
    font-family: inherit;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .wordwise-analysis-loading-caption {
    font-size: 12px;
    line-height: 1.55;
    color: #64748b;
  }
  .wordwise-analysis-loading-orbit {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 12px;
  }
  .wordwise-analysis-loading-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: rgba(96, 165, 250, 0.72);
    box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.18);
    animation: wordwise-analysis-dot-pulse 1.25s ease-in-out infinite;
  }
  .wordwise-analysis-loading-dot:nth-child(2) {
    animation-delay: 0.15s;
  }
  .wordwise-analysis-loading-dot:nth-child(3) {
    animation-delay: 0.3s;
  }
  .wordwise-analysis-loading-dot:nth-child(4) {
    animation-delay: 0.45s;
  }
  .wordwise-analysis-loading-line {
    position: relative;
    height: 3px;
    margin-top: 12px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(148, 163, 184, 0.18);
  }
  .wordwise-analysis-loading-line::after {
    content: "";
    position: absolute;
    inset: 0;
    width: 42%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(96, 165, 250, 0.1), rgba(96, 165, 250, 0.48), rgba(167, 139, 250, 0.18));
    animation: wordwise-analysis-line-sweep 1.3s ease-in-out infinite;
  }
  .wordwise-analysis-view[data-phase="loading"] .wordwise-analysis-section {
    display: none;
  }
  .wordwise-analysis-view[data-phase="loading"] .wordwise-analysis-loading {
    display: block;
  }
  .wordwise-analysis-view[data-phase="ready"] .wordwise-analysis-section {
    animation: wordwise-analysis-reveal 280ms ease-out both;
  }
  .wordwise-analysis-view[data-phase="ready"] .wordwise-analysis-section:nth-of-type(1) {
    animation-delay: 0ms;
  }
  .wordwise-analysis-view[data-phase="ready"] .wordwise-analysis-section:nth-of-type(2) {
    animation-delay: 36ms;
  }
  .wordwise-analysis-view[data-phase="ready"] .wordwise-analysis-section:nth-of-type(3) {
    animation-delay: 72ms;
  }
  .wordwise-analysis-view[data-phase="ready"] .wordwise-analysis-section:nth-of-type(4) {
    animation-delay: 108ms;
  }
  @keyframes wordwise-analysis-loading-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes wordwise-analysis-dot-pulse {
    0%, 100% {
      transform: translateY(0) scale(0.88);
      opacity: 0.36;
      box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.08);
    }
    50% {
      transform: translateY(-1px) scale(1);
      opacity: 1;
      box-shadow: 0 0 0 6px rgba(96, 165, 250, 0);
    }
  }
  @keyframes wordwise-analysis-line-sweep {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(260%);
    }
  }
  @keyframes wordwise-analysis-reveal {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .wordwise-analysis-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  .wordwise-analysis-source,
  .wordwise-analysis-translation,
  .wordwise-analysis-structure,
  .wordwise-analysis-vocabulary,
  .wordwise-analysis-summary,
  .wordwise-analysis-grammar {
    font-size: 14px;
    line-height: 1.7;
    color: #1f2937;
    font-family: var(--wordwise-ui-font);
  }
  .wordwise-analysis-card-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    min-width: 0;
  }
  .wordwise-analysis-card-spacer {
    min-height: 1px;
  }
  .wordwise-analysis-card-panel,
  .wordwise-analysis-step-panel {
    position: relative;
    min-width: 0;
    padding: 11px 13px 12px;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 255, 255, 0.66);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      0 10px 24px rgba(148, 163, 184, 0.08);
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }
  .wordwise-analysis-card-panel:hover,
  .wordwise-analysis-step-panel:hover {
    background: rgba(255, 255, 255, 0.78);
    border-color: rgba(148, 163, 184, 0.24);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.58),
      0 12px 28px rgba(148, 163, 184, 0.1);
  }
  .wordwise-analysis-card-panel--tone-0,
  .wordwise-analysis-step-card--tone-0 .wordwise-analysis-step-panel {
    background: linear-gradient(180deg, rgba(239, 246, 255, 0.82), rgba(255, 255, 255, 0.72));
  }
  .wordwise-analysis-card-panel--tone-1,
  .wordwise-analysis-step-card--tone-1 .wordwise-analysis-step-panel {
    background: linear-gradient(180deg, rgba(255, 247, 237, 0.84), rgba(255, 255, 255, 0.72));
  }
  .wordwise-analysis-card-panel--tone-2,
  .wordwise-analysis-step-card--tone-2 .wordwise-analysis-step-panel {
    background: linear-gradient(180deg, rgba(250, 245, 255, 0.86), rgba(255, 255, 255, 0.72));
  }
  .wordwise-analysis-card-panel--tone-3,
  .wordwise-analysis-step-card--tone-3 .wordwise-analysis-step-panel {
    background: linear-gradient(180deg, rgba(240, 253, 244, 0.84), rgba(255, 255, 255, 0.72));
  }
  .wordwise-analysis-source {
    font-size: 13.5px;
    line-height: 2;
    color: #334155;
  }
  .wordwise-analysis-translation,
  .wordwise-analysis-structure {
    font-size: 13.5px;
    line-height: 1.82;
    letter-spacing: 0.005em;
    color: #334155;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }
  .wordwise-analysis-vocabulary-list,
  .wordwise-analysis-summary-list,
  .wordwise-analysis-grammar-list,
  .wordwise-analysis-clause-list {
    display: grid;
    gap: 10px;
  }
  .wordwise-analysis-vocab-item,
  .wordwise-analysis-summary-item,
  .wordwise-analysis-grammar-item,
  .wordwise-analysis-clause-item {
    border-radius: 12px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }
  .wordwise-analysis-vocab-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .wordwise-analysis-vocab-check {
    color: #16a34a;
    font-weight: 700;
    line-height: 1.4;
    flex: 0 0 auto;
  }
  .wordwise-analysis-vocab-body {
    min-width: 0;
    line-height: 1.7;
  }
  .wordwise-analysis-vocab-head {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: baseline;
  }
  .wordwise-analysis-vocab-text {
    font-size: 15px;
    font-weight: 700;
    color: #172033;
  }
  .wordwise-analysis-vocab-phonetic {
    color: #7c6f45;
    font-weight: 600;
  }
  .wordwise-analysis-vocab-meaning {
    color: #334155;
  }
  .wordwise-analysis-vocab-pos {
    color: #64748b;
    font-weight: 600;
    margin-right: 6px;
  }
  .wordwise-analysis-summary-key,
  .wordwise-analysis-grammar-title,
  .wordwise-analysis-clause-title {
    font-weight: 700;
    color: #134e4a;
    margin-bottom: 4px;
  }
  .wordwise-analysis-summary-value,
  .wordwise-analysis-grammar-text,
  .wordwise-analysis-clause-text,
  .wordwise-analysis-clause-note {
    color: #1f2937;
    line-height: 1.75;
  }
  .wordwise-analysis-board {
    margin-top: 10px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.82);
    border: 1px solid rgba(148, 163, 184, 0.16);
  }
  .wordwise-analysis-board-title,
  .wordwise-analysis-subtitle {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #6b7280;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .wordwise-analysis-board-text,
  .wordwise-analysis-simplified {
    font-size: 14px;
    line-height: 1.8;
    color: #1f2937;
  }
  .wordwise-analysis-simplified-box {
    margin-top: 10px;
    padding: 10px 12px;
    border-left: 3px solid rgba(16, 185, 129, 0.55);
    background: rgba(16, 185, 129, 0.08);
    border-radius: 10px;
  }
  .wordwise-analysis-clause-note {
    margin-top: 4px;
    color: #475569;
  }
  .wordwise-analysis-grammar-examples {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #334155;
  }
  .wordwise-analysis-grammar-examples li {
    margin-bottom: 6px;
  }
  .wordwise-analysis-empty {
    color: #64748b;
  }
  .wordwise-analysis-steps {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 2px 0 0;
    display: grid;
    gap: 12px;
  }
  .wordwise-analysis-steps::before {
    content: "";
    position: absolute;
    left: 17px;
    top: 16px;
    bottom: 16px;
    width: 1px;
    background: linear-gradient(
      180deg,
      rgba(148, 163, 184, 0),
      rgba(148, 163, 184, 0.3) 12%,
      rgba(148, 163, 184, 0.28) 88%,
      rgba(148, 163, 184, 0)
    );
  }
  .wordwise-analysis-step-card {
    position: relative;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    min-width: 0;
  }
  .wordwise-analysis-step-rail {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    padding-top: 6px;
  }
  .wordwise-analysis-step-dot {
    min-width: 26px;
    height: 26px;
    padding: 0 7px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.05em;
    box-shadow:
      0 6px 16px rgba(255, 255, 255, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.58);
  }
  .wordwise-analysis-step-panel {
  }
  .wordwise-analysis-step-card--tone-0 .wordwise-analysis-step-dot {
    color: #1d4ed8;
    background: rgba(219, 234, 254, 0.9);
    box-shadow:
      0 6px 16px rgba(37, 99, 235, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.66);
  }
  .wordwise-analysis-step-card--tone-1 .wordwise-analysis-step-dot {
    color: #c2410c;
    background: rgba(254, 215, 170, 0.64);
    box-shadow:
      0 6px 16px rgba(234, 88, 12, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.66);
  }
  .wordwise-analysis-step-card--tone-2 .wordwise-analysis-step-dot {
    color: #6d28d9;
    background: rgba(233, 213, 255, 0.72);
    box-shadow:
      0 6px 16px rgba(147, 51, 234, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.66);
  }
  .wordwise-analysis-step-card--tone-3 .wordwise-analysis-step-dot {
    color: #166534;
    background: rgba(220, 252, 231, 0.78);
    box-shadow:
      0 6px 16px rgba(22, 163, 74, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.66);
  }
  .wordwise-analysis-step-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .wordwise-analysis-step-accent {
    width: 14px;
    height: 2px;
    border-radius: 999px;
    flex: 0 0 auto;
  }
  .wordwise-analysis-step-card--tone-0 .wordwise-analysis-step-accent {
    background: rgba(29, 78, 216, 0.56);
  }
  .wordwise-analysis-step-card--tone-1 .wordwise-analysis-step-accent {
    background: rgba(194, 65, 12, 0.54);
  }
  .wordwise-analysis-step-card--tone-2 .wordwise-analysis-step-accent {
    background: rgba(109, 40, 217, 0.54);
  }
  .wordwise-analysis-step-card--tone-3 .wordwise-analysis-step-accent {
    background: rgba(22, 101, 52, 0.52);
  }
  .wordwise-analysis-step-tag {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.06em;
    color: #64748b;
  }
  .wordwise-analysis-step-body {
    font-family: var(--wordwise-ui-font);
    font-size: 13.5px;
    line-height: 1.82;
    letter-spacing: 0.005em;
    color: #334155;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    overflow-wrap: anywhere;
  }
  .wordwise-analysis-step-lead {
    display: block;
    margin-bottom: 7px;
    color: #24364d;
    font-weight: 600;
    line-height: 1.78;
  }
  .wordwise-analysis-step-rest {
    color: #475569;
  }
  .wordwise-analysis-inline-emphasis {
    display: inline;
    font-weight: 600;
    color: #24364d;
    background: linear-gradient(180deg, transparent 62%, rgba(191, 219, 254, 0.24) 62%, rgba(191, 219, 254, 0.24) 96%, transparent 96%);
    box-shadow: inset 0 -0.07em 0 rgba(96, 165, 250, 0.1);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .wordwise-analysis-substeps {
    list-style: none;
    margin: 7px 0 0;
    padding: 0;
    display: grid;
    gap: 7px;
  }
  .wordwise-analysis-substeps li {
    position: relative;
    padding-left: 13px;
    color: #475569;
    line-height: 1.78;
  }
  .wordwise-analysis-substeps li {
    margin-bottom: 0;
  }
  .wordwise-analysis-substeps li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.88em;
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.52);
  }
  .wordwise-analysis-legend {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .wordwise-clause-block {
    display: inline;
    vertical-align: baseline;
    padding: 0 0.22em 0.08em;
    border: 0;
    border-radius: 2px;
    margin-right: 0.14em;
    white-space: normal;
    line-height: 1.45;
    color: #1f2a44;
    background:
      linear-gradient(
        180deg,
        transparent 0%,
        transparent 18%,
        var(--wordwise-marker-fill) 18%,
        var(--wordwise-marker-fill) 82%,
        transparent 83%,
        transparent 100%
      );
    box-shadow:
      inset 0 -1px 0 rgba(31, 42, 68, 0.015),
      0 1px 2px rgba(255, 255, 255, 0.03);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .wordwise-clause-subblock {
    display: inline;
    vertical-align: baseline;
    padding: 0 0.1em 0.04em;
    border-radius: 2px;
    margin-right: 0.06em;
    background: linear-gradient(180deg, transparent 28%, rgba(255, 255, 255, 0.04) 28%, rgba(255, 255, 255, 0.08) 72%, transparent 72%);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .wordwise-clause-block--tone-0 {
    --wordwise-marker-fill: rgba(255, 91, 173, 0.2);
  }
  .wordwise-clause-block--tone-1 {
    --wordwise-marker-fill: rgba(168, 255, 102, 0.18);
  }
  .wordwise-clause-block--tone-2 {
    --wordwise-marker-fill: rgba(255, 238, 56, 0.2);
  }
  .wordwise-clause-block .wordwise-mark {
    background: transparent;
    border-radius: 0;
    padding: 0;
    color: inherit;
    font-weight: 800;
    box-shadow: inset 0 -0.26em 0 var(--wordwise-mark-underline-strong, rgba(29, 78, 216, 0.56));
  }
  .wordwise-clause-block .wordwise-mark--subject {
    box-shadow: inset 0 -0.26em 0 rgba(29, 78, 216, 0.56);
  }
  .wordwise-clause-block .wordwise-mark--predicate {
    box-shadow: inset 0 -0.26em 0 rgba(194, 65, 12, 0.56);
  }
  .wordwise-clause-block .wordwise-mark--nonfinite {
    box-shadow: inset 0 -0.26em 0 rgba(109, 40, 217, 0.56);
    font-weight: 900;
  }
  .wordwise-clause-block .wordwise-mark--conjunction {
    box-shadow: inset 0 -0.26em 0 rgba(63, 98, 18, 0.56);
  }
  .wordwise-clause-block .wordwise-mark--relative {
    box-shadow: inset 0 -0.26em 0 rgba(67, 56, 202, 0.56);
  }
  .wordwise-clause-block .wordwise-mark--preposition {
    box-shadow: inset 0 -0.26em 0 rgba(14, 116, 144, 0.56);
    font-weight: 700;
  }
  .wordwise-analysis-pill {
    display: inline-flex;
    align-items: center;
    position: relative;
    isolation: isolate;
    padding: 1px 7px 3px;
    border-radius: 2px;
    font-size: 12px;
    font-weight: 600;
  }
  .wordwise-analysis-pill::before {
    content: "";
    position: absolute;
    inset: 0 -3px;
    z-index: -1;
    opacity: 0.62;
    background:
      linear-gradient(180deg, transparent 21%, var(--wordwise-pill-fill) 21%, var(--wordwise-pill-fill) 79%, transparent 79%);
    box-shadow: inset 0 -1px 0 rgba(31, 42, 68, 0.02);
  }
  .wordwise-mark {
    padding: 1px 4px;
    border-radius: 6px;
    font-weight: 700;
    box-shadow: inset 0 -0.16em 0 var(--wordwise-mark-underline, rgba(29, 78, 216, 0.44));
  }
  .wordwise-mark--subject {
    background: rgba(59, 130, 246, 0.16);
    color: #1d4ed8;
    --wordwise-mark-underline: rgba(29, 78, 216, 0.46);
    --wordwise-mark-underline-strong: rgba(29, 78, 216, 0.56);
  }
  .wordwise-pill--subject {
    --wordwise-pill-fill: rgba(59, 130, 246, 0.08);
    color: #1d4ed8;
  }
  .wordwise-mark--predicate {
    background: rgba(249, 115, 22, 0.16);
    color: #c2410c;
    --wordwise-mark-underline: rgba(194, 65, 12, 0.46);
    --wordwise-mark-underline-strong: rgba(194, 65, 12, 0.56);
  }
  .wordwise-pill--predicate {
    --wordwise-pill-fill: rgba(249, 115, 22, 0.08);
    color: #c2410c;
  }
  .wordwise-mark--nonfinite {
    background: rgba(139, 92, 246, 0.2);
    color: #6d28d9;
    --wordwise-mark-underline: rgba(109, 40, 217, 0.46);
    --wordwise-mark-underline-strong: rgba(109, 40, 217, 0.56);
  }
  .wordwise-pill--nonfinite {
    --wordwise-pill-fill: rgba(168, 85, 247, 0.1);
    color: #6d28d9;
  }
  .wordwise-mark--conjunction {
    background: rgba(190, 242, 100, 0.18);
    color: #3f6212;
    --wordwise-mark-underline: rgba(63, 98, 18, 0.46);
    --wordwise-mark-underline-strong: rgba(63, 98, 18, 0.56);
  }
  .wordwise-pill--conjunction {
    --wordwise-pill-fill: rgba(190, 242, 100, 0.1);
    color: #3f6212;
  }
  .wordwise-mark--relative {
    background: rgba(129, 140, 248, 0.18);
    color: #4338ca;
    --wordwise-mark-underline: rgba(67, 56, 202, 0.46);
    --wordwise-mark-underline-strong: rgba(67, 56, 202, 0.56);
  }
  .wordwise-pill--relative {
    --wordwise-pill-fill: rgba(129, 140, 248, 0.12);
    color: #4338ca;
  }
  .wordwise-mark--preposition {
    background: rgba(34, 211, 238, 0.16);
    color: #0e7490;
    --wordwise-mark-underline: rgba(14, 116, 144, 0.46);
    --wordwise-mark-underline-strong: rgba(14, 116, 144, 0.56);
  }
  .wordwise-pill--preposition {
    --wordwise-pill-fill: rgba(34, 211, 238, 0.1);
    color: #0e7490;
  }
  @keyframes wordwise-fade {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
`;

const HIGHLIGHT_STYLE = `
  ::highlight(${HIGHLIGHT_NAME}) {
    background: rgba(250, 204, 21, 0.28);
    font-weight: 600;
  }
`;

const SPEAKER_ICON = `
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M7 3.2 4.6 5.2H2.9a.9.9 0 0 0-.9.9v3.8c0 .5.4.9.9.9h1.7L7 12.8a.55.55 0 0 0 .9-.43V3.63A.55.55 0 0 0 7 3.2Z" fill="currentColor"/>
    <path d="M10.3 5.4a3.2 3.2 0 0 1 0 5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M11.9 4a5.1 5.1 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
`;


interface HoverContext {
  surface: string;
  rect: DOMRect;
  requestId: number;
  forceTranslate?: boolean;
  contextText?: string;
}

interface SentenceSelectionContext {
  text: string;
  rect: DOMRect;
  requestId: number;
  contextText?: string;
  selectedFontSizePx?: number;
}

interface SelectedTextContext {
  text: string;
  rect: DOMRect;
  requestId: number;
  contextText: string;
  selectedFontSizePx?: number;
}

function isAlphaNumeric(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9]/u.test(char));
}

function isStructuralTechnicalBoundaryCharacter(char: string | undefined): boolean {
  return Boolean(char && /[_@/\\]/u.test(char));
}

function isHyphenLinkedToTechnicalToken(text: string, start: number, end: number): boolean {
  if (text[end] === "-") {
    const trailing = text.slice(end + 1, Math.min(text.length, end + 24));
    if (/^[A-Za-z'-]*[@_\\/]/u.test(trailing)) {
      return true;
    }
  }

  if (text[start - 1] === "-") {
    const leading = text.slice(Math.max(0, start - 24), start - 1);
    if (/[@_\\/][A-Za-z'-]*$/u.test(leading)) {
      return true;
    }
  }

  return false;
}

function isDotEmbeddedInTechnicalToken(text: string, start: number, end: number): boolean {
  return (
    text[start - 1] === "." ||
    (text[end] === "." && isAlphaNumeric(text[end + 1]))
  );
}

function isUrlSchemeBoundary(text: string, start: number, end: number): boolean {
  return (
    (text[end] === ":" && text[end + 1] === "/") ||
    (text[start - 1] === "/" && text[start - 2] === ":")
  );
}

function isEmbeddedInTechnicalToken(text: string, start: number, end: number): boolean {
  return (
    isAlphaNumeric(text[start - 1]) ||
    isAlphaNumeric(text[end]) ||
    isStructuralTechnicalBoundaryCharacter(text[start - 1]) ||
    isStructuralTechnicalBoundaryCharacter(text[end]) ||
    isHyphenLinkedToTechnicalToken(text, start, end) ||
    isDotEmbeddedInTechnicalToken(text, start, end) ||
    isUrlSchemeBoundary(text, start, end)
  );
}

function extractSentenceAroundRange(text: string, start: number, end: number): string {
  const leftBoundary = Math.max(
    text.lastIndexOf(".", start - 1),
    text.lastIndexOf("!", start - 1),
    text.lastIndexOf("?", start - 1),
    text.lastIndexOf("\n", start - 1),
  );
  const rightCandidates = [
    text.indexOf(".", end),
    text.indexOf("!", end),
    text.indexOf("?", end),
    text.indexOf("\n", end),
  ].filter((value) => value >= 0);
  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
  const sentence = text.slice(leftBoundary >= 0 ? leftBoundary + 1 : 0, rightBoundary).trim();

  if (!sentence) {
    return text.slice(Math.max(0, start - 100), Math.min(text.length, end + 100)).trim();
  }

  return sentence;
}

function extractContextAroundDomRange(range: Range, fallback: string): string {
  const startContainer = range.startContainer;

  if (startContainer.nodeType === Node.TEXT_NODE && startContainer === range.endContainer) {
    const textNode = startContainer as Text;
    const localText = textNode.textContent ?? "";
    const localSentence = extractSentenceAroundRange(localText, range.startOffset, range.endOffset);

    if (countEnglishWords(localSentence) >= 4 || /\bby\s+[A-Za-z]/i.test(localSentence)) {
      return localSentence;
    }
  }

  let ancestor: Element | null =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;

  for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
    if (isIgnoredContainer(ancestor)) {
      continue;
    }

    const text = ancestor.textContent ?? "";
    const compact = normalizeSelectionText(text);

    if (!compact || compact === fallback || compact.length > 1200) {
      continue;
    }

    try {
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(ancestor);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const start = prefixRange.toString().length;

      const selectionLength = range.toString().length;
      const candidate = extractSentenceAroundRange(text, start, start + selectionLength);

      if (countEnglishWords(candidate) < 2) {
        continue;
      }

      if (
        /\bby\s+[A-Za-z]/i.test(candidate) ||
        /\b(?:points?|comments?|hours?\s+ago|minutes?\s+ago|hide|past|favorite|root|parent|next)\b/i.test(candidate) ||
        countEnglishWords(fallback) < 4
      ) {
        return normalizeSelectionText(candidate);
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function waitForDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeHighlightWord(value: string): string {
  return value.toLowerCase().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
}

interface HighlightSegment {
  surface: string;
  start: number;
  end: number;
}

function getHighlightSegments(surface: string, start: number): HighlightSegment[] {
  if (!surface.includes("-")) {
    return [{ surface, start, end: start + surface.length }];
  }

  const segments: HighlightSegment[] = [];
  const matcher = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  let match = matcher.exec(surface);

  while (match) {
    segments.push({
      surface: match[0],
      start: start + match.index,
      end: start + match.index + match[0].length,
    });
    match = matcher.exec(surface);
  }

  return segments.length ? segments : [{ surface, start, end: start + surface.length }];
}

function isAnalyzableSelectionText(text: string): boolean {
  const compact = normalizeSelectionText(text);

  if (!compact || compact.length < 32 || compact.length > 360) {
    return false;
  }

  if (/[\u4e00-\u9fff]/u.test(compact)) {
    return false;
  }

  const words = compact.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  return words.length >= 7;
}

const HIGHLIGHT_CATEGORY_META = {
  subject: {
    labelKey: "highlightSubject",
    className: "wordwise-mark--subject",
    pillClassName: "wordwise-pill--subject",
  },
  predicate: {
    labelKey: "highlightPredicate",
    className: "wordwise-mark--predicate",
    pillClassName: "wordwise-pill--predicate",
  },
  nonfinite: {
    labelKey: "highlightNonfinite",
    className: "wordwise-mark--nonfinite",
    pillClassName: "wordwise-pill--nonfinite",
  },
  conjunction: {
    labelKey: "highlightConjunction",
    className: "wordwise-mark--conjunction",
    pillClassName: "wordwise-pill--conjunction",
  },
  relative: {
    labelKey: "highlightRelative",
    className: "wordwise-mark--relative",
    pillClassName: "wordwise-pill--relative",
  },
  preposition: {
    labelKey: "highlightPreposition",
    className: "wordwise-mark--preposition",
    pillClassName: "wordwise-pill--preposition",
  },
} as const;

const CONNECTOR_WORDS = new Set([
  "and", "but", "or", "yet", "so", "although", "though", "because", "if", "while",
  "when", "whereas", "unless", "since", "once", "before", "after", "whether",
]);
const RELATIVE_WORDS = new Set([
  "that", "which", "who", "whom", "whose", "where", "when", "why",
]);
const POSSESSIVE_DETERMINER_WORDS = new Set([
  "my", "your", "his", "her", "its", "our", "their",
]);

interface SentenceWordToken {
  index: number;
  text: string;
  normalized: string;
  start: number;
  end: number;
}

function tokenizeSentenceWords(sentence: string): SentenceWordToken[] {
  const tokens: SentenceWordToken[] = [];
  const regex = createEnglishTokenMatcher();
  let match: RegExpExecArray | null = regex.exec(sentence);
  let index = 0;

  while (match) {
    const text = match[0];
    const start = match.index;
    tokens.push({
      index,
      text,
      normalized: normalizeHighlightWord(text),
      start,
      end: start + text.length,
    });
    index += 1;
    match = regex.exec(sentence);
  }

  return tokens;
}

function assignFirstMatchingToken(
  tokens: SentenceWordToken[],
  assignments: Map<number, keyof typeof HIGHLIGHT_CATEGORY_META>,
  predicate: (token: SentenceWordToken) => boolean,
  category: keyof typeof HIGHLIGHT_CATEGORY_META,
): boolean {
  for (const token of tokens) {
    if (!assignments.has(token.index) && predicate(token)) {
      assignments.set(token.index, category);
      return true;
    }
  }

  return false;
}

function buildHighlightAssignments(
  result: SentenceAnalysisResult,
  sentence: string,
): Map<number, keyof typeof HIGHLIGHT_CATEGORY_META> {
  const tokens = tokenizeSentenceWords(sentence);
  const assignments = new Map<number, keyof typeof HIGHLIGHT_CATEGORY_META>();

  for (const item of result.highlights) {
    const normalized = normalizeHighlightWord(item.text);

    if (
      !normalized ||
      POSSESSIVE_DETERMINER_WORDS.has(normalized) ||
      (normalized === "that" && item.category !== "relative" && item.category !== "conjunction")
    ) {
      continue;
    }

    assignFirstMatchingToken(
      tokens,
      assignments,
        (token) => token.normalized === normalized,
      item.category,
    );
  }

  return assignments;
}

function renderSentenceMarkup(result: SentenceAnalysisResult, sentence: string): string {
  const tokens = tokenizeSentenceWords(sentence);
  const assignments = buildHighlightAssignments(result, sentence);
  return renderTextRangeWithAssignments(sentence, 0, sentence.length, tokens, assignments);
}

function renderTextRangeWithAssignments(
  sentence: string,
  start: number,
  end: number,
  tokens: SentenceWordToken[],
  assignments: Map<number, keyof typeof HIGHLIGHT_CATEGORY_META>,
): string {
  let cursor = start;
  let markup = "";

  for (const token of tokens) {
    if (token.end <= start || token.start >= end) {
      continue;
    }

    if (token.start > cursor) {
      markup += escapeHtml(sentence.slice(cursor, token.start));
    }

    const category = assignments.get(token.index);

    if (!category) {
      markup += escapeHtml(sentence.slice(token.start, token.end));
    } else {
      markup += `<span class="wordwise-mark ${HIGHLIGHT_CATEGORY_META[category].className}">${escapeHtml(sentence.slice(token.start, token.end))}</span>`;
    }

    cursor = token.end;
  }

  if (cursor < end) {
    markup += escapeHtml(sentence.slice(cursor, end));
  }

  return markup;
}

function buildInnerClauseSegments(text: string): Array<{ start: number; end: number }> {
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];

  if (words.length < 10) {
    return [{ start: 0, end: text.length }];
  }

  const boundaryPattern =
    /,\s+|\b(?:which|who|whom|whose|that|how|whether|why|because|if|although|though|when|where|while|but|and|through|with|over|by|for|into)\b/gi;
  const boundaries = [0];
  let match = boundaryPattern.exec(text);

  while (match) {
    const boundaryIndex = match[0].startsWith(",") ? match.index + match[0].length : match.index;
    const previous = boundaries[boundaries.length - 1];

    if (boundaryIndex - previous >= 18) {
      boundaries.push(boundaryIndex);
    }

    match = boundaryPattern.exec(text);
  }

  if (text.length - boundaries[boundaries.length - 1] < 18 && boundaries.length > 1) {
    boundaries.pop();
  }

  boundaries.push(text.length);

  const segments: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];

    if (end <= start) {
      continue;
    }

    segments.push({ start, end });
  }

  return segments.length > 1 ? segments : [{ start: 0, end: text.length }];
}

function renderClauseBlockContent(
  sentence: string,
  start: number,
  end: number,
  tokens: SentenceWordToken[],
  assignments: Map<number, keyof typeof HIGHLIGHT_CATEGORY_META>,
): string {
  const blockText = sentence.slice(start, end);
  const segments = buildInnerClauseSegments(blockText);

  if (segments.length === 1) {
    return renderTextRangeWithAssignments(sentence, start, end, tokens, assignments);
  }

  return segments
    .map((segment) => {
      const segmentText = sentence.slice(start + segment.start, start + segment.end);

      if (!/[A-Za-z]/.test(segmentText)) {
        return escapeHtml(segmentText);
      }

      return `<span class="wordwise-clause-subblock">${renderTextRangeWithAssignments(
        sentence,
        start + segment.start,
        start + segment.end,
        tokens,
        assignments,
      )}</span>`;
    })
    .join("");
}

const ANALYSIS_STEP_LABEL_KEYS = [
  "analysisStepSegmentation",
  "analysisStepBackbone",
  "analysisStepBranches",
  "analysisStepTranslationOrder",
] as const;
const ANALYSIS_STEP_TONE_CLASSES = [
  "wordwise-analysis-step-card--tone-0",
  "wordwise-analysis-step-card--tone-1",
  "wordwise-analysis-step-card--tone-2",
  "wordwise-analysis-step-card--tone-3",
] as const;
const ANALYSIS_INLINE_EMPHASIS_PATTERN =
  /[A-Za-z][A-Za-z0-9'/-]*(?:\s+[A-Za-z0-9'/.(),-]+){0,7}/g;

function normalizeAnalysisStepText(step: string): string {
  return step
    .trim()
    .replace(/^(?:step\s*)?\d+[\.\)）:：-]\s*/iu, "")
    .replace(/^第\s*\d+\s*步[\s:：-]*/u, "");
}

function renderAnalysisInlineMarkup(text: string): string {
  ANALYSIS_INLINE_EMPHASIS_PATTERN.lastIndex = 0;

  let markup = "";
  let cursor = 0;
  let match: RegExpExecArray | null = ANALYSIS_INLINE_EMPHASIS_PATTERN.exec(text);

  while (match) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;

    if (start > cursor) {
      markup += escapeHtml(text.slice(cursor, start));
    }

    const wordCount = value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
    const shouldEmphasize =
      wordCount >= 2 ||
      /[-/]/.test(value) ||
      value.length >= 7 ||
      /(?:\.{3}|…)/.test(value);

    markup += shouldEmphasize
      ? `<span class="wordwise-analysis-inline-emphasis">${escapeHtml(value)}</span>`
      : escapeHtml(value);
    cursor = end;
    match = ANALYSIS_INLINE_EMPHASIS_PATTERN.exec(text);
  }

  if (cursor < text.length) {
    markup += escapeHtml(text.slice(cursor));
  }

  return markup;
}

function splitAnalysisLead(text: string): { lead: string; rest: string } {
  const trimmed = text.trim();

  if (trimmed.length < 22) {
    return { lead: "", rest: trimmed };
  }

  const strongBreaks = ["：", ":", "。", "；", ";"];

  for (const mark of strongBreaks) {
    const index = trimmed.indexOf(mark);

    if (index >= 7 && index <= 36 && trimmed.length - index - 1 >= 10) {
      return {
        lead: trimmed.slice(0, index + 1).trim(),
        rest: trimmed.slice(index + 1).trim(),
      };
    }
  }

  const commaIndex = trimmed.indexOf("，");

  if (commaIndex >= 10 && commaIndex <= 28 && trimmed.length - commaIndex - 1 >= 12) {
    return {
      lead: trimmed.slice(0, commaIndex + 1).trim(),
      rest: trimmed.slice(commaIndex + 1).trim(),
    };
  }

  return { lead: "", rest: trimmed };
}

function buildAnalysisStepContentMarkup(step: string): string {
  const trimmed = normalizeAnalysisStepText(step);
  const subStepPattern = /(?:^|\s)(\d+[\)）])/g;
  const markers = [...trimmed.matchAll(subStepPattern)];

  if (markers.length >= 2) {
    const firstMarkerIndex = markers[0]?.index ?? -1;

    if (firstMarkerIndex >= 0) {
      const intro = trimmed.slice(0, firstMarkerIndex).trim().replace(/[:：]\s*$/, "");
      const items = markers
        .map((marker, index) => {
          const markerIndex = marker.index ?? 0;
          const start = markerIndex + marker[0].length;
          const nextMarkerIndex =
            index + 1 < markers.length ? (markers[index + 1].index ?? trimmed.length) : trimmed.length;
          return trimmed.slice(start, nextMarkerIndex).trim();
        })
        .filter(Boolean);

      if (items.length) {
        const introMarkup = intro
          ? `<span class="wordwise-analysis-step-lead">${renderAnalysisInlineMarkup(intro)}</span>`
          : "";
        const listMarkup = items
          .map((item) => `<li>${renderAnalysisInlineMarkup(item)}</li>`)
          .join("");

        return `${introMarkup}<ul class="wordwise-analysis-substeps">${listMarkup}</ul>`;
      }
    }
  }

  const { lead, rest } = splitAnalysisLead(trimmed);

  if (!lead) {
    return `<span class="wordwise-analysis-step-rest">${renderAnalysisInlineMarkup(trimmed)}</span>`;
  }

  const restMarkup = rest
    ? `<span class="wordwise-analysis-step-rest">${renderAnalysisInlineMarkup(rest)}</span>`
    : "";

  return `<span class="wordwise-analysis-step-lead">${renderAnalysisInlineMarkup(lead)}</span>${restMarkup}`;
}

function renderAnalysisStepsMarkup(steps: string[]): string {
  return steps
    .map((step, index) => {
      const toneClass =
        ANALYSIS_STEP_TONE_CLASSES[index] ??
        ANALYSIS_STEP_TONE_CLASSES[ANALYSIS_STEP_TONE_CLASSES.length - 1];
      const label = ANALYSIS_STEP_LABEL_KEYS[index]
        ? ui(ANALYSIS_STEP_LABEL_KEYS[index])
        : ui("analysisStepFallback", { index: index + 1 });
      const stepNumber = String(index + 1).padStart(2, "0");
      const bodyMarkup = buildAnalysisStepContentMarkup(step);

      return `
        <li class="wordwise-analysis-step-card ${toneClass}">
          <div class="wordwise-analysis-step-rail">
            <span class="wordwise-analysis-step-dot">${stepNumber}</span>
          </div>
          <div class="wordwise-analysis-step-panel">
            <div class="wordwise-analysis-step-header">
              <span class="wordwise-analysis-step-accent"></span>
              <span class="wordwise-analysis-step-tag">${label}</span>
            </div>
            <div class="wordwise-analysis-step-body">${bodyMarkup}</div>
          </div>
        </li>
      `.trim();
    })
    .join("");
}

function renderLegendMarkup(result: SentenceAnalysisResult, sentence: string): string {
  const assignments = buildHighlightAssignments(result, sentence);
  const categories = [
    ...new Set([...assignments.values()]),
  ];

  if (!categories.length) {
    return "";
  }

  return categories
    .map((category) => {
      const meta = HIGHLIGHT_CATEGORY_META[category];
      return `<span class="wordwise-analysis-pill ${meta.pillClassName}">${ui(meta.labelKey)}</span>`;
    })
    .join("");
}

const CLAUSE_BLOCK_TONE_CLASSES = [
  "wordwise-clause-block--tone-0",
  "wordwise-clause-block--tone-1",
  "wordwise-clause-block--tone-2",
] as const;

function renderSentenceWithClauseBlocks(
  result: SentenceAnalysisResult,
  sentence: string,
): string {
  if (!result.clauseBlocks.length) {
    return renderSentenceMarkup(result, sentence);
  }

  const tokens = tokenizeSentenceWords(sentence);
  const assignments = buildHighlightAssignments(result, sentence);
  const displayBlocks = getDisplayClauseBlocks(sentence, result.clauseBlocks);

  let cursor = 0;
  let matchedCount = 0;
  let markup = "";

  for (const block of displayBlocks) {
    if (block.start > cursor) {
      const gapText = sentence.slice(cursor, block.start);

      if (/[A-Za-z]/.test(gapText)) {
        const gapClassName = CLAUSE_BLOCK_TONE_CLASSES[matchedCount % CLAUSE_BLOCK_TONE_CLASSES.length];
        markup += `<span class="wordwise-clause-block ${gapClassName}">${renderClauseBlockContent(
          sentence,
          cursor,
          block.start,
          tokens,
          assignments,
        )}</span>`;
        matchedCount += 1;
      } else {
        markup += renderTextRangeWithAssignments(sentence, cursor, block.start, tokens, assignments);
      }
    }

    const className = CLAUSE_BLOCK_TONE_CLASSES[matchedCount % CLAUSE_BLOCK_TONE_CLASSES.length];
    markup += `<span class="wordwise-clause-block ${className}">${renderClauseBlockContent(
      sentence,
      block.start,
      block.end,
      tokens,
      assignments,
    )}</span>`;
    cursor = block.end;
    matchedCount += 1;
  }

  if (!matchedCount) {
    return renderSentenceMarkup(result, sentence);
  }

  if (cursor < sentence.length) {
    const tailText = sentence.slice(cursor);

    if (/[A-Za-z]/.test(tailText)) {
      const tailClassName = CLAUSE_BLOCK_TONE_CLASSES[matchedCount % CLAUSE_BLOCK_TONE_CLASSES.length];
      markup += `<span class="wordwise-clause-block ${tailClassName}">${renderClauseBlockContent(
        sentence,
        cursor,
        sentence.length,
        tokens,
        assignments,
      )}</span>`;
    } else {
      markup += renderTextRangeWithAssignments(sentence, cursor, sentence.length, tokens, assignments);
    }
  }

  return markup;
}

function createTooltipRoot() {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483647";
  host.style.display = "none";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOOLTIP_STYLE;
  const card = document.createElement("div");
  card.className = "wordwise-card";
  card.dataset.layout = "word";

  const closeButton = document.createElement("button");
  closeButton.className = "wordwise-close";
  closeButton.type = "button";
  closeButton.dataset.visible = "false";
  closeButton.setAttribute("aria-label", ui("tooltipClose"));
  closeButton.textContent = "×";

  const surfaceHeaderEl = document.createElement("div");
  surfaceHeaderEl.className = "wordwise-surface-row";

  const surfaceEl = document.createElement("div");
  surfaceEl.className = "wordwise-surface";

  const surfacePosEl = document.createElement("span");
  surfacePosEl.className = "wordwise-surface-pos";
  surfacePosEl.dataset.visible = "false";
  surfaceHeaderEl.append(surfaceEl, surfacePosEl);

  const pronunciationEl = document.createElement("div");
  pronunciationEl.className = "wordwise-pronunciation";
  pronunciationEl.dataset.visible = "false";

  const translationEl = document.createElement("div");
  translationEl.className = "wordwise-translation";
  translationEl.dataset.visible = "false";
  translationEl.dataset.compact = "false";
  translationEl.dataset.transition = "idle";
  const hintEl = document.createElement("div");
  hintEl.className = "wordwise-hint";
  hintEl.dataset.visible = "true";
  hintEl.dataset.loading = "false";
  hintEl.dataset.kind = "prompt";
  hintEl.textContent = ui("tooltipSwitchToContextualTranslation");

  const actionsEl = document.createElement("div");
  actionsEl.className = "wordwise-actions";
  const actionIndicatorEl = document.createElement("div");
  actionIndicatorEl.className = "wordwise-action-indicator";
  actionIndicatorEl.dataset.visible = "false";

  const llmButton = document.createElement("button");
  llmButton.className = "wordwise-button wordwise-button--secondary";
  llmButton.textContent = ui("tooltipContextTranslate");

  const britishChip = document.createElement("div");
  britishChip.className = "wordwise-pronunciation-chip";
  const britishText = document.createElement("span");
  britishText.className = "wordwise-pronunciation-text";
  const britishLabel = document.createElement("span");
  britishLabel.className = "wordwise-pronunciation-label";
  britishLabel.textContent = ui("tooltipUk");
  const britishPhoneticEl = document.createElement("span");
  britishPhoneticEl.className = "wordwise-pronunciation-ipa";
  britishPhoneticEl.textContent = "/.../";
  const britishButton = document.createElement("button");
  britishButton.className = "wordwise-pronunciation-action";
  britishButton.type = "button";
  britishButton.setAttribute("aria-label", ui("tooltipPlayUkPronunciation"));
  britishButton.innerHTML = SPEAKER_ICON;
  britishText.append(britishLabel, britishPhoneticEl);
  britishChip.append(britishText, britishButton);

  const americanChip = document.createElement("div");
  americanChip.className = "wordwise-pronunciation-chip";
  const americanText = document.createElement("span");
  americanText.className = "wordwise-pronunciation-text";
  const americanLabel = document.createElement("span");
  americanLabel.className = "wordwise-pronunciation-label";
  americanLabel.textContent = ui("tooltipUs");
  const americanPhoneticEl = document.createElement("span");
  americanPhoneticEl.className = "wordwise-pronunciation-ipa";
  americanPhoneticEl.textContent = "/.../";
  const americanButton = document.createElement("button");
  americanButton.className = "wordwise-pronunciation-action";
  americanButton.type = "button";
  americanButton.setAttribute("aria-label", ui("tooltipPlayUsPronunciation"));
  americanButton.innerHTML = SPEAKER_ICON;
  americanText.append(americanLabel, americanPhoneticEl);
  americanChip.append(americanText, americanButton);
  pronunciationEl.append(britishChip, americanChip);

  const selectionAnalysisButton = document.createElement("button");
  selectionAnalysisButton.className = "wordwise-button wordwise-button--secondary";
  selectionAnalysisButton.textContent = ui("tooltipSentenceAnalysis");

  const ignoreButton = document.createElement("button");
  ignoreButton.className = "wordwise-button wordwise-button--secondary";
  ignoreButton.textContent = ui("tooltipIgnore");

  const metaEl = document.createElement("div");
  metaEl.className = "wordwise-meta";

  const metaDividerEl = document.createElement("span");
  metaDividerEl.className = "wordwise-meta-divider";
  metaDividerEl.textContent = "•";
  metaDividerEl.setAttribute("aria-hidden", "true");

  const rankEl = document.createElement("span");
  rankEl.className = "wordwise-rank";
  rankEl.dataset.kind = "rank";

  const button = document.createElement("button");
  button.className = "wordwise-button";
  button.textContent = ui("tooltipKnown");
  button.title = ui("tooltipKnownTitle");

  const primaryTranslationEl = document.createElement("div");
  primaryTranslationEl.className = "wordwise-primary-translation";
  const primaryTranslationTextEl = document.createElement("span");
  primaryTranslationTextEl.className = "wordwise-primary-translation-text";
  const primaryTranslationPosEl = document.createElement("span");
  primaryTranslationPosEl.className = "wordwise-primary-translation-pos";
  primaryTranslationPosEl.dataset.visible = "false";
  primaryTranslationEl.append(primaryTranslationTextEl, primaryTranslationPosEl);

  const secondaryTranslationEl = document.createElement("div");
  secondaryTranslationEl.className = "wordwise-secondary-translation";
  secondaryTranslationEl.dataset.visible = "false";

  const englishExplanationEl = document.createElement("div");
  englishExplanationEl.className = "wordwise-english-explanation";
  englishExplanationEl.dataset.visible = "false";
  const englishExplanationLabelEl = document.createElement("div");
  englishExplanationLabelEl.className = "wordwise-english-explanation-label";
  englishExplanationLabelEl.textContent = ui("tooltipEnglishExplanation");
  const englishExplanationTextEl = document.createElement("div");
  englishExplanationTextEl.className = "wordwise-english-explanation-text";
  englishExplanationEl.append(englishExplanationLabelEl, englishExplanationTextEl);

  const wordView = document.createElement("div");
  wordView.className = "wordwise-word-view";
  wordView.dataset.visible = "true";
  wordView.dataset.layout = "word";

  const analysisView = document.createElement("div");
  analysisView.className = "wordwise-analysis-view";
  analysisView.dataset.visible = "false";
  analysisView.dataset.phase = "idle";

  const analysisHeader = document.createElement("div");
  analysisHeader.className = "wordwise-analysis-header";

  const analysisTitleEl = document.createElement("div");
  analysisTitleEl.className = "wordwise-analysis-title";
  analysisTitleEl.textContent = ui("tooltipSentenceAnalysis");

  const analysisTriggerButton = document.createElement("button");
  analysisTriggerButton.className = "wordwise-button";
  analysisTriggerButton.textContent = ui("tooltipStartAnalysis");

  const analysisStatusEl = document.createElement("div");
  analysisStatusEl.className = "wordwise-analysis-status";
  analysisStatusEl.dataset.loading = "false";

  const analysisLoadingEl = document.createElement("div");
  analysisLoadingEl.className = "wordwise-analysis-loading";
  analysisLoadingEl.dataset.visible = "false";
  const analysisLoadingOrbitEl = document.createElement("div");
  analysisLoadingOrbitEl.className = "wordwise-analysis-loading-orbit";
  analysisLoadingOrbitEl.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 4; index += 1) {
    const dotEl = document.createElement("span");
    dotEl.className = "wordwise-analysis-loading-dot";
    analysisLoadingOrbitEl.append(dotEl);
  }
  const analysisLoadingTitleEl = document.createElement("div");
  analysisLoadingTitleEl.className = "wordwise-analysis-loading-title";
  analysisLoadingTitleEl.textContent = ui("tooltipAnalyzingSentence");
  const analysisLoadingCaptionEl = document.createElement("div");
  analysisLoadingCaptionEl.className = "wordwise-analysis-loading-caption";
  analysisLoadingCaptionEl.textContent = ui("tooltipAnalyzingSentenceCaption");
  const analysisLoadingLineEl = document.createElement("div");
  analysisLoadingLineEl.className = "wordwise-analysis-loading-line";
  analysisLoadingLineEl.setAttribute("aria-hidden", "true");
  analysisLoadingEl.append(
    analysisLoadingOrbitEl,
    analysisLoadingTitleEl,
    analysisLoadingCaptionEl,
    analysisLoadingLineEl,
  );

  const analysisSourceSection = document.createElement("section");
  analysisSourceSection.className = "wordwise-analysis-section";
  const analysisSourceLabel = document.createElement("div");
  analysisSourceLabel.className = "wordwise-analysis-label";
  analysisSourceLabel.textContent = ui("tooltipSentenceBreakdown");
  const analysisSourceCardRow = document.createElement("div");
  analysisSourceCardRow.className = "wordwise-analysis-card-row";
  const analysisSourceCardSpacer = document.createElement("div");
  analysisSourceCardSpacer.className = "wordwise-analysis-card-spacer";
  const analysisSourceCardPanel = document.createElement("div");
  analysisSourceCardPanel.className = "wordwise-analysis-card-panel wordwise-analysis-card-panel--tone-0";
  const analysisSourceEl = document.createElement("div");
  analysisSourceEl.className = "wordwise-analysis-source";
  const analysisLegendEl = document.createElement("div");
  analysisLegendEl.className = "wordwise-analysis-legend";
  analysisSourceCardPanel.append(analysisSourceEl, analysisLegendEl);
  analysisSourceCardRow.append(analysisSourceCardSpacer, analysisSourceCardPanel);
  analysisSourceSection.append(analysisSourceLabel, analysisSourceCardRow);

  const analysisStructureSection = document.createElement("section");
  analysisStructureSection.className = "wordwise-analysis-section";
  const analysisStructureLabel = document.createElement("div");
  analysisStructureLabel.className = "wordwise-analysis-label";
  analysisStructureLabel.textContent = ui("tooltipBackbone");
  const analysisStructureCardRow = document.createElement("div");
  analysisStructureCardRow.className = "wordwise-analysis-card-row";
  const analysisStructureCardSpacer = document.createElement("div");
  analysisStructureCardSpacer.className = "wordwise-analysis-card-spacer";
  const analysisStructureCardPanel = document.createElement("div");
  analysisStructureCardPanel.className = "wordwise-analysis-card-panel wordwise-analysis-card-panel--tone-2";
  const analysisStructureEl = document.createElement("div");
  analysisStructureEl.className = "wordwise-analysis-structure";
  analysisStructureCardPanel.append(analysisStructureEl);
  analysisStructureCardRow.append(analysisStructureCardSpacer, analysisStructureCardPanel);
  analysisStructureSection.append(analysisStructureLabel, analysisStructureCardRow);

  const analysisStepsSection = document.createElement("section");
  analysisStepsSection.className = "wordwise-analysis-section wordwise-analysis-section--steps";
  const analysisStepsLabel = document.createElement("div");
  analysisStepsLabel.className = "wordwise-analysis-label";
  analysisStepsLabel.textContent = ui("tooltipAnalysisSteps");
  const analysisStepsEl = document.createElement("ol");
  analysisStepsEl.className = "wordwise-analysis-steps";
  analysisStepsSection.append(analysisStepsLabel, analysisStepsEl);

  const analysisTranslationSection = document.createElement("section");
  analysisTranslationSection.className = "wordwise-analysis-section";
  const analysisTranslationLabel = document.createElement("div");
  analysisTranslationLabel.className = "wordwise-analysis-label";
  analysisTranslationLabel.textContent = ui("tooltipTranslation");
  const analysisTranslationCardRow = document.createElement("div");
  analysisTranslationCardRow.className = "wordwise-analysis-card-row";
  const analysisTranslationCardSpacer = document.createElement("div");
  analysisTranslationCardSpacer.className = "wordwise-analysis-card-spacer";
  const analysisTranslationCardPanel = document.createElement("div");
  analysisTranslationCardPanel.className = "wordwise-analysis-card-panel wordwise-analysis-card-panel--tone-1";
  const analysisTranslationEl = document.createElement("div");
  analysisTranslationEl.className = "wordwise-analysis-translation";
  analysisTranslationCardPanel.append(analysisTranslationEl);
  analysisTranslationCardRow.append(analysisTranslationCardSpacer, analysisTranslationCardPanel);
  analysisTranslationSection.append(analysisTranslationLabel, analysisTranslationCardRow);

  translationEl.append(
    primaryTranslationEl,
    secondaryTranslationEl,
    englishExplanationEl,
    metaEl,
  );
  actionsEl.append(actionIndicatorEl, llmButton, selectionAnalysisButton, ignoreButton, button);
  metaEl.append(hintEl, metaDividerEl, rankEl);
  wordView.append(surfaceHeaderEl, pronunciationEl, translationEl, actionsEl);
  analysisHeader.append(analysisTitleEl, analysisTriggerButton);
  analysisView.append(
    analysisHeader,
    analysisStatusEl,
    analysisLoadingEl,
    analysisSourceSection,
    analysisTranslationSection,
    analysisStructureSection,
    analysisStepsSection,
  );
  card.append(closeButton, wordView, analysisView);
  shadow.append(style, card);
  document.documentElement.append(host);

  return {
    host,
    card,
    closeButton,
    wordView,
    analysisView,
    surfaceHeaderEl,
    surfaceEl,
    surfacePosEl,
    pronunciationEl,
    britishLabel,
    britishPhoneticEl,
    americanLabel,
    americanPhoneticEl,
    hintEl,
    translationEl,
    primaryTranslationEl,
    primaryTranslationTextEl,
    primaryTranslationPosEl,
    secondaryTranslationEl,
    englishExplanationEl,
    englishExplanationLabelEl,
    englishExplanationTextEl,
    rankEl,
    metaEl,
    actionsEl,
    actionIndicatorEl,
    button,
    llmButton,
    britishButton,
    americanButton,
    selectionAnalysisButton,
    ignoreButton,
    analysisTitleEl,
    analysisTriggerButton,
    analysisStatusEl,
    analysisLoadingEl,
    analysisLoadingTitleEl,
    analysisLoadingCaptionEl,
    analysisSourceLabel,
    analysisSourceEl,
    analysisLegendEl,
    analysisStructureLabel,
    analysisTranslationEl,
    analysisTranslationLabel,
    analysisStructureEl,
    analysisStepsLabel,
    analysisStepsEl,
  };
}

function installHighlightStyle() {
  const style = document.createElement("style");
  style.dataset.wordwise = "highlight-style";
  style.textContent = HIGHLIGHT_STYLE;
  document.documentElement.append(style);
}

function getCaretRangeFromPoint(x: number, y: number): { node: Text; offset: number } | null {
  if ("caretPositionFromPoint" in document) {
    const caret = document.caretPositionFromPoint(x, y);
    if (caret?.offsetNode?.nodeType === Node.TEXT_NODE) {
      return {
        node: caret.offsetNode as Text,
        offset: caret.offset,
      };
    }
  }

  if ("caretRangeFromPoint" in document) {
    const caret = document.caretRangeFromPoint(x, y);
    if (caret?.startContainer?.nodeType === Node.TEXT_NODE) {
      return {
        node: caret.startContainer as Text,
        offset: caret.startOffset,
      };
    }
  }

  return null;
}

function getSelectedWordContext(pointer?: { clientX: number; clientY: number }): HoverContext | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const rawSurface = selection.toString();
  let surface = normalizeSingleEnglishWord(rawSurface);
  let range = selection.getRangeAt(0).cloneRange();

  if (pointer) {
    const caret = getCaretRangeFromPoint(pointer.clientX, pointer.clientY);

    if (caret) {
      const text = caret.node.textContent ?? "";
      const pointedWord = extractWordAtOffset(text, caret.offset);

      if (pointedWord) {
        surface = pointedWord.surface;
        range = document.createRange();
        range.setStart(caret.node, pointedWord.start);
        range.setEnd(caret.node, pointedWord.end);
      }
    }
  }

  if (!surface || !isSingleEnglishWord(surface)) {
    return null;
  }

  if (
    rawSurface.trim() !== surface &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.startContainer === range.endContainer
  ) {
    const baseStartOffset = range.startOffset;
    const trimmedStart = rawSurface.search(/[A-Za-z']/);

    if (trimmedStart >= 0) {
      range.setStart(range.startContainer, baseStartOffset + trimmedStart);
      range.setEnd(range.endContainer, baseStartOffset + trimmedStart + surface.length);
    } else {
      range.setEnd(range.endContainer, baseStartOffset + surface.length);
    }
  }

  const rect = range.getBoundingClientRect();

  if ((!rect.width && !rect.height) || !isFinite(rect.left) || !isFinite(rect.top)) {
    return null;
  }

  const contextText = extractContextAroundDomRange(range, surface);

  activeRequestId += 1;

  return {
    surface,
    rect,
    requestId: activeRequestId,
    forceTranslate: true,
    contextText,
  };
}

function getSelectionContextText(range: Range, fallback: string): string {
  return extractContextAroundDomRange(range, fallback);
}

function getSelectedTextContext(): SelectedTextContext | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0).cloneRange();
  const text = normalizeSelectionText(selection.toString());
  const selectedFontSizePx = resolveSelectionFontSizePx(range);

  if (
    !isEnglishSelectionText(text) ||
    shouldIgnoreSelectionRange(range)
  ) {
    return null;
  }

  const rect = range.getBoundingClientRect();

  if ((!rect.width && !rect.height) || !isFinite(rect.left) || !isFinite(rect.top)) {
    return null;
  }

  selectionRequestId += 1;

  return {
    text,
    rect,
    requestId: selectionRequestId,
    contextText: getSelectionContextText(range, text),
    selectedFontSizePx,
  };
}

function getSelectedSentenceContext(): SentenceSelectionContext | null {
  const context = getSelectedTextContext();

  if (!context || !isAnalyzableSelectionText(context.text)) {
    return null;
  }

  return context;
}

function getNodeElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

const MIN_SELECTION_TRANSLATION_FONT_SIZE_PX = 15.4;
const MAX_SELECTION_TRANSLATION_FONT_SIZE_PX = 18.8;
const MIN_SELECTION_SECONDARY_FONT_SIZE_PX = 12.6;
const MAX_SELECTION_SECONDARY_FONT_SIZE_PX = 14.2;

function clampSelectionTypographyValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deriveSelectionTranslationFontSizePx(sourceFontSizePx: number): number {
  return clampSelectionTypographyValue(
    sourceFontSizePx * 0.74 + 4,
    MIN_SELECTION_TRANSLATION_FONT_SIZE_PX,
    MAX_SELECTION_TRANSLATION_FONT_SIZE_PX,
  );
}

function deriveSelectionSecondaryFontSizePx(translationFontSizePx: number): number {
  return clampSelectionTypographyValue(
    translationFontSizePx * 0.79,
    MIN_SELECTION_SECONDARY_FONT_SIZE_PX,
    MAX_SELECTION_SECONDARY_FONT_SIZE_PX,
  );
}

function deriveSelectionLineHeight(translationFontSizePx: number): number {
  return translationFontSizePx >= 17.6 ? 1.7 : 1.76;
}

function parsePixelSize(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveSelectionFontSizePx(range: Range): number | undefined {
  const candidates = [
    getNodeElement(range.startContainer),
    getNodeElement(range.commonAncestorContainer),
    getNodeElement(range.endContainer),
  ];

  for (const element of candidates) {
    if (!element) {
      continue;
    }

    const fontSizePx = parsePixelSize(window.getComputedStyle(element).fontSize);

    if (fontSizePx !== null) {
      return fontSizePx;
    }
  }

  return undefined;
}

function isInsideTooltip(node: Node): boolean {
  return node.getRootNode() === tooltip.host.shadowRoot;
}

function isHardIgnoredElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element.closest("input, textarea, select, option, script, style, noscript")) {
    return true;
  }

  if (element.closest("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']")) {
    return true;
  }

  return false;
}

function getSoftIgnoredElement(element: Element | null): Element | null {
  return element?.closest("code, pre") ?? null;
}

function shouldIgnoreSelectionRange(range: Range): boolean {
  if (isInsideTooltip(range.startContainer) || isInsideTooltip(range.endContainer)) {
    return true;
  }

  const startElement = getNodeElement(range.startContainer);
  const endElement = getNodeElement(range.endContainer);

  if (isHardIgnoredElement(startElement) || isHardIgnoredElement(endElement)) {
    return true;
  }

  const commonElement = getNodeElement(range.commonAncestorContainer);

  if (!commonElement) {
    return false;
  }

  return Boolean(getSoftIgnoredElement(commonElement));
}

function isIgnoredContainer(node: Node): boolean {
  if (isInsideTooltip(node)) {
    return true;
  }

  const element = getNodeElement(node);

  if (!element) {
    return false;
  }

  if (isHardIgnoredElement(element)) {
    return true;
  }

  return Boolean(getSoftIgnoredElement(element));
}

function rankLabel(result: LexiconLookupResult): string {
  if (result.rank === null) {
    return ui("statusOutOfList");
  }

  return ui("tooltipRankLabel", { rank: result.rank });
}

function showWordMetaStatus(text: string) {
  tooltip.hintEl.dataset.visible = "false";
  tooltip.hintEl.dataset.loading = "false";
  tooltip.rankEl.dataset.kind = "status";
  tooltip.rankEl.textContent = text;
}

function restoreWordMetaRank() {
  tooltip.rankEl.dataset.kind = "rank";
  tooltip.rankEl.textContent = tooltip.rankEl.dataset.rankLabel ?? "";
}

function getTranslationActionButtonText(provider: TranslationProviderChoice): string {
  return provider === "llm" ? ui("tooltipContextTranslate") : ui("tooltipGoogleTranslate");
}

function getTranslationActionPrompt(provider: TranslationProviderChoice): string {
  return provider === "llm"
    ? ui("tooltipSwitchToContextualTranslation")
    : ui("tooltipSwitchToGoogleTranslation");
}

function setDisplayedTranslationProvider(provider: TranslationProviderChoice) {
  activeDisplayedTranslationProvider = provider;
  const nextProvider = getAlternateTranslationProvider(provider);
  tooltip.llmButton.dataset.provider = nextProvider;
  tooltip.llmButton.textContent = getTranslationActionButtonText(nextProvider);

  if (tooltip.hintEl.dataset.kind === "prompt") {
    tooltip.hintEl.textContent = getTranslationActionPrompt(nextProvider);
  }
}

function runtimeSend<T>(message: RuntimeMessage): Promise<T> {
  const runtimeApi = globalThis.chrome?.runtime;

  if (!runtimeApi?.sendMessage) {
    return Promise.reject(new Error("Extension context invalidated."));
  }

  return runtimeApi.sendMessage(message) as Promise<T>;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    (error instanceof TypeError && message.includes("sendmessage")) ||
    message.includes("extension context invalidated") ||
    message.includes("message channel closed before a response was received") ||
    message.includes("a listener indicated an asynchronous response")
  );
}

function supportsHighlights(): boolean {
  return typeof Highlight !== "undefined" && "highlights" in CSS;
}

function shouldSkipTextNode(node: Text): boolean {
  if (!node.textContent?.trim()) {
    return true;
  }

  return isIgnoredContainer(node);
}

function isVisibleRect(rect: DOMRect): boolean {
  const bleed = 120;

  return !(
    rect.bottom < -bleed ||
    rect.right < -bleed ||
    rect.top > window.innerHeight + bleed ||
    rect.left > window.innerWidth + bleed
  );
}

const tooltip = createTooltipRoot();
installHighlightStyle();

function applyTooltipLocale() {
  tooltip.closeButton.setAttribute("aria-label", ui("tooltipClose"));
  tooltip.britishLabel.textContent = ui("tooltipUk");
  tooltip.britishButton.setAttribute("aria-label", ui("tooltipPlayUkPronunciation"));
  tooltip.americanLabel.textContent = ui("tooltipUs");
  tooltip.americanButton.setAttribute("aria-label", ui("tooltipPlayUsPronunciation"));
  tooltip.selectionAnalysisButton.textContent = ui("tooltipSentenceAnalysis");
  tooltip.ignoreButton.textContent = ui("tooltipIgnore");
  tooltip.button.textContent = ui("tooltipKnown");
  tooltip.button.title = ui("tooltipKnownTitle");
  tooltip.englishExplanationLabelEl.textContent = ui("tooltipEnglishExplanation");
  tooltip.analysisTitleEl.textContent = ui("tooltipSentenceAnalysis");
  tooltip.analysisTriggerButton.textContent = ui("tooltipStartAnalysis");
  tooltip.analysisLoadingTitleEl.textContent = ui("tooltipAnalyzingSentence");
  tooltip.analysisLoadingCaptionEl.textContent = ui("tooltipAnalyzingSentenceCaption");
  tooltip.analysisSourceLabel.textContent = ui("tooltipSentenceBreakdown");
  tooltip.analysisTranslationLabel.textContent = ui("tooltipTranslation");
  tooltip.analysisStructureLabel.textContent = ui("tooltipBackbone");
  tooltip.analysisStepsLabel.textContent = ui("tooltipAnalysisSteps");
  setDisplayedTranslationProvider(activeDisplayedTranslationProvider);
}

async function refreshLearnerLanguage() {
  try {
    const translatorSettings = await getTranslatorSettings();
    currentLearnerLanguageCode = translatorSettings.learnerLanguageCode;
    currentDefaultTranslationProvider = translatorSettings.defaultTranslationProvider;
  } catch {
    currentLearnerLanguageCode = "zh-CN";
    currentDefaultTranslationProvider = "google";
  }

  activeDisplayedTranslationProvider = currentDefaultTranslationProvider;
  applyTooltipLocale();
}

let hoverTimer: number | null = null;
let hideTimer: number | null = null;
let highlightTimer: number | null = null;
let selectionTriggerTimer: number | null = null;
let activeRequestId = 0;
let activeResult: LexiconLookupResult | null = null;
let activeAnchorRect: DOMRect | null = null;
let activeContext: HoverContext | null = null;
let currentSettings: UserSettings | null = null;
let tooltipHovered = false;
let lastMouseX = 0;
let lastMouseY = 0;
let activeTranslationRequestId = 0;
let activeSelectionTooltipContext: SelectedTextContext | null = null;
let activeSelectionTranslationRequestId = 0;
let activeSelectionContext: SentenceSelectionContext | null = null;
let selectionRequestId = 0;
let analysisPanelOpen = false;
let activeSentenceAnalysisRequestId = 0;
let suppressSelectionTriggerUntil = 0;
let pointerSelecting = false;
let activeWordTooltipSource: "hover-word" | "review-word" | "selection-translate" = "hover-word";
let activePronunciationSurface = "";
let activePronunciationRequestId = 0;
let activePronunciationResult: PronunciationResult | null = null;
let activePronunciationAudio: HTMLAudioElement | null = null;

function stopActivePronunciationAudio() {
  if (!activePronunciationAudio) {
    return;
  }

  activePronunciationAudio.pause();
  activePronunciationAudio.currentTime = 0;
  activePronunciationAudio = null;
}

function isPersistentTooltipSession(): boolean {
  return tooltip.host.style.display === "block" &&
    (activeWordTooltipSource === "selection-translate" || analysisPanelOpen);
}

function hideTooltip() {
  stopActivePronunciationAudio();
  clearSelectionTriggerTimer();
  tooltip.host.style.display = "none";
  tooltip.card.style.removeProperty("--wordwise-selection-translation-size");
  tooltip.card.dataset.mode = "word";
  tooltip.card.dataset.layout = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  tooltip.closeButton.dataset.visible = "false";
  tooltip.translationEl.dataset.transition = "idle";
  activeResult = null;
  activeAnchorRect = null;
  activeContext = null;
  activeSelectionTooltipContext = null;
  activeTranslationRequestId += 1;
  activeSelectionTranslationRequestId += 1;
  activePronunciationRequestId += 1;
  activePronunciationSurface = "";
  activePronunciationResult = null;
  activeWordTooltipSource = "hover-word";
  activeDisplayedTranslationProvider = currentDefaultTranslationProvider;
  if (!analysisPanelOpen) {
    activeSelectionContext = null;
  }
}

function cancelActiveAsyncRequests() {
  activeRequestId += 1;
  activeTranslationRequestId += 1;
  activeSelectionTranslationRequestId += 1;
  activeSentenceAnalysisRequestId += 1;
}

function resetEnglishExplanationDisplay() {
  tooltip.englishExplanationEl.dataset.visible = "false";
  tooltip.englishExplanationTextEl.textContent = "";
}

function isLlmTranslationProvider(provider?: string) {
  return provider === "llm";
}

function setPrimaryTranslationContent(
  translation?: string,
  contextualPartOfSpeech?: string,
  provider?: string,
) {
  tooltip.primaryTranslationTextEl.textContent = translation ?? "";
  const pos = isLlmTranslationProvider(provider) ? contextualPartOfSpeech ?? "" : "";
  tooltip.primaryTranslationPosEl.textContent = pos;
  tooltip.primaryTranslationPosEl.dataset.visible = pos ? "true" : "false";
}

function getDefaultActionIndicatorTarget(): HTMLButtonElement | null {
  if (tooltip.wordView.dataset.layout === "selection") {
    if (tooltip.selectionAnalysisButton.style.display !== "none") {
      return tooltip.selectionAnalysisButton;
    }

    if (tooltip.llmButton.style.display !== "none") {
      return tooltip.llmButton;
    }
  }

  if (tooltip.button.style.display !== "none") {
    return tooltip.button;
  }

  if (tooltip.llmButton.style.display !== "none") {
    return tooltip.llmButton;
  }

  return null;
}

function setActionIndicator(target?: HTMLButtonElement | null) {
  const layout = tooltip.wordView.dataset.layout;

  if (layout !== "word" && layout !== "selection") {
    tooltip.actionIndicatorEl.dataset.visible = "false";
    return;
  }

  const button = target ?? getDefaultActionIndicatorTarget();

  if (!button || button.style.display === "none") {
    tooltip.actionIndicatorEl.dataset.visible = "false";
    return;
  }

  const actionsRect = tooltip.actionsEl.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();

  if (!actionsRect.width || !buttonRect.width) {
    tooltip.actionIndicatorEl.dataset.visible = "false";
    return;
  }

  tooltip.actionsEl.style.setProperty("--wordwise-action-indicator-x", `${buttonRect.left - actionsRect.left}px`);
  tooltip.actionsEl.style.setProperty("--wordwise-action-indicator-y", `${buttonRect.top - actionsRect.top}px`);
  tooltip.actionsEl.style.setProperty("--wordwise-action-indicator-width", `${buttonRect.width}px`);
  tooltip.actionsEl.style.setProperty("--wordwise-action-indicator-height", `${buttonRect.height}px`);
  tooltip.actionIndicatorEl.dataset.visible = "true";
}

function syncActionIndicator(target?: HTMLButtonElement | null) {
  requestAnimationFrame(() => {
    setActionIndicator(target);
  });
}

function showEnglishExplanation(explanation: string) {
  tooltip.englishExplanationTextEl.textContent = explanation;
  tooltip.englishExplanationEl.dataset.visible = "true";
}

function applySelectionTypography(context?: Pick<SelectedTextContext, "selectedFontSizePx"> | null) {
  if (context?.selectedFontSizePx) {
    const translationFontSizePx = deriveSelectionTranslationFontSizePx(context.selectedFontSizePx);
    const secondaryFontSizePx = deriveSelectionSecondaryFontSizePx(translationFontSizePx);
    const lineHeight = deriveSelectionLineHeight(translationFontSizePx);

    tooltip.card.style.setProperty(
      "--wordwise-selection-translation-size",
      `${translationFontSizePx}px`,
    );
    tooltip.card.style.setProperty("--wordwise-selection-secondary-size", `${secondaryFontSizePx}px`);
    tooltip.card.style.setProperty("--wordwise-selection-line-height", `${lineHeight}`);
    return;
  }

  tooltip.card.style.removeProperty("--wordwise-selection-translation-size");
  tooltip.card.style.removeProperty("--wordwise-selection-secondary-size");
  tooltip.card.style.removeProperty("--wordwise-selection-line-height");
}

function setTranslationPresentation(
  mode: "word" | "selection",
  translation?: string,
  sentenceTranslation?: string,
  englishExplanation?: string,
) {
  const hasSecondary = Boolean(sentenceTranslation?.trim());
  const hasExplanation = Boolean(englishExplanation?.trim());
  const shouldCompact = mode === "word" && Boolean(translation?.trim()) && !hasSecondary && !hasExplanation;

  tooltip.translationEl.dataset.compact = shouldCompact ? "true" : "false";
}

function hasVisibleTranslationContent(): boolean {
  return tooltip.translationEl.dataset.visible === "true" &&
    Boolean(tooltip.primaryTranslationEl.textContent?.trim());
}

function beginTranslationTransition(): boolean {
  const shouldPreserve = hasVisibleTranslationContent();
  tooltip.translationEl.dataset.transition = shouldPreserve ? "loading" : "idle";
  return shouldPreserve;
}

async function animateTranslationSwap(applyResult: () => void | Promise<void>) {
  const hadPreviousResult = hasVisibleTranslationContent();

  if (hadPreviousResult) {
    tooltip.translationEl.dataset.transition = "swap-out";
    await waitForDelay(110);
  }

  await applyResult();

  if (tooltip.translationEl.dataset.visible === "true") {
    tooltip.translationEl.dataset.transition = "swap-in";
    await waitForPaint();
  }

  tooltip.translationEl.dataset.transition = "idle";
}

function clearHighlights() {
  if (!supportsHighlights()) {
    return;
  }

  CSS.highlights.delete(HIGHLIGHT_NAME);
}

function scheduleHide() {
  if (isPersistentTooltipSession()) {
    return;
  }

  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }

  hideTimer = window.setTimeout(() => {
    if (
      tooltipHovered ||
      isPointerNearTooltip(lastMouseX, lastMouseY) ||
      isPointerNearAnchor(lastMouseX, lastMouseY) ||
      isPointerInTooltipCorridor(lastMouseX, lastMouseY)
    ) {
      scheduleHide();
      return;
    }

    hideTooltip();
  }, HIDE_DELAY_MS);
}

async function refreshHighlightsNow() {
  clearHighlights();
  await refreshHighlights();
}

function positionTooltip(rect: DOMRect) {
  const margin = 12;
  const cardRect = tooltip.card.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 4;

  if (left + cardRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - cardRect.width - margin);
  }

  if (top + cardRect.height > window.innerHeight - margin) {
    top = rect.top - cardRect.height - 4;
  }

  if (top < margin) {
    top = margin;
  }

  tooltip.card.style.left = `${left}px`;
  tooltip.card.style.top = `${top}px`;
}

function hideSentenceAnalysis(options?: { preservePanel?: boolean }) {
  if (!options?.preservePanel) {
    tooltip.hintEl.dataset.loading = "false";
    tooltip.analysisStatusEl.textContent = "";
    tooltip.analysisStatusEl.dataset.loading = "false";
    tooltip.analysisLoadingEl.dataset.visible = "false";
    tooltip.analysisView.dataset.phase = "idle";
    tooltip.analysisSourceEl.innerHTML = "";
    tooltip.analysisLegendEl.innerHTML = "";
    tooltip.analysisTranslationEl.textContent = "";
    tooltip.analysisStructureEl.textContent = "";
    tooltip.analysisStepsEl.innerHTML = "";
    tooltip.analysisTriggerButton.style.display = "none";
    analysisPanelOpen = false;
    activeSelectionContext = null;
  }

  tooltip.analysisView.dataset.visible = "false";
  tooltip.card.dataset.mode = "word";
}

function positionSentenceAnalysisButton(rect: DOMRect) {
  positionTooltip(rect);
}

function positionSentenceAnalysisPanel(rect: DOMRect) {
  positionTooltip(rect);
}

function setWordTooltipControls(mode: "word" | "selection") {
  const isSelection = mode === "selection";
  tooltip.card.dataset.layout = mode;
  tooltip.wordView.dataset.layout = mode;
  tooltip.button.style.display = isSelection ? "none" : "inline-flex";
  tooltip.ignoreButton.style.display = isSelection ? "none" : "inline-flex";
  tooltip.metaEl.style.display = "flex";
  tooltip.rankEl.style.display = isSelection ? "none" : "inline";
  tooltip.llmButton.style.display = "inline-flex";
  tooltip.pronunciationEl.dataset.visible = isSelection ? "false" : "true";
  tooltip.surfaceHeaderEl.style.display = isSelection ? "none" : "flex";
  tooltip.closeButton.dataset.visible = isSelection ? "true" : "false";
  tooltip.britishButton.dataset.playing = "false";
  tooltip.americanButton.dataset.playing = "false";
  tooltip.selectionAnalysisButton.style.display = isSelection ? "inline-flex" : "none";
  syncActionIndicator();
}

function formatPronunciationDisplayText(value?: string, audioUrl?: string): string {
  if (value) {
    return value;
  }

  return audioUrl ? "Audio only" : "No IPA";
}

function resetPronunciationDisplay(surface: string) {
  activePronunciationSurface = surface;
  activePronunciationResult = null;
  tooltip.britishPhoneticEl.textContent = "/.../";
  tooltip.americanPhoneticEl.textContent = "/.../";
}

async function loadPronunciation(surface: string) {
  activePronunciationRequestId += 1;
  const requestId = activePronunciationRequestId;
  const normalizedSurface = surface.trim();

  if (!normalizedSurface) {
    return;
  }

  let response: PronunciationLookupResponse;

  try {
    response = await runtimeSend<PronunciationLookupResponse>({
      type: "LOOKUP_PRONUNCIATION",
      payload: {
        surface: normalizedSurface,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (
    !response.ok ||
    requestId !== activePronunciationRequestId ||
    activeWordTooltipSource === "selection-translate" ||
    activePronunciationSurface !== normalizedSurface
  ) {
    return;
  }

  activePronunciationResult = response.result ?? null;
  tooltip.britishPhoneticEl.textContent = formatPronunciationDisplayText(
    response.result?.ukPhonetic,
    response.result?.ukAudioUrl,
  );
  tooltip.americanPhoneticEl.textContent = formatPronunciationDisplayText(
    response.result?.usPhonetic,
    response.result?.usAudioUrl,
  );
}

function renderSelectionTooltip(
  context: SelectedTextContext,
  result?: {
    translation?: string;
    sentenceTranslation?: string;
    translationProvider?: string;
  },
) {
  const displayedProvider = result?.translationProvider
    ? normalizeDisplayedTranslationProvider(result.translationProvider)
    : currentDefaultTranslationProvider;
  tooltip.card.dataset.mode = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  setWordTooltipControls("selection");
  applySelectionTypography(context);
  tooltip.surfaceEl.textContent = "";
  tooltip.surfacePosEl.textContent = "";
  tooltip.surfacePosEl.dataset.visible = "false";
  setPrimaryTranslationContent(result?.translation, undefined, result?.translationProvider);
  tooltip.secondaryTranslationEl.textContent = result?.sentenceTranslation ?? "";
  tooltip.secondaryTranslationEl.dataset.visible = result?.sentenceTranslation ? "true" : "false";
  resetEnglishExplanationDisplay();
  setTranslationPresentation("selection", result?.translation, result?.sentenceTranslation);
  tooltip.translationEl.dataset.visible = "true";
  tooltip.hintEl.dataset.visible = "true";
  tooltip.hintEl.dataset.loading = "false";
  tooltip.hintEl.dataset.kind = "status";
  tooltip.hintEl.textContent = displayedProvider === "llm"
    ? ui("tooltipContextualTranslationUsed")
    : ui("tooltipDefaultGoogleResult");
  tooltip.rankEl.dataset.kind = "rank";
  tooltip.rankEl.dataset.rankLabel = "";
  tooltip.rankEl.textContent = "";
  tooltip.host.style.display = "block";
  activeAnchorRect = context.rect;
  activeSelectionTooltipContext = context;
  activeSelectionContext = context;
  activeWordTooltipSource = "selection-translate";
  setDisplayedTranslationProvider(displayedProvider);
  activePronunciationRequestId += 1;
  activePronunciationSurface = "";
  activeContext = null;
  activeResult = null;
  analysisPanelOpen = false;
  positionTooltip(context.rect);
}

function showSentenceAnalysisButton(context: SentenceSelectionContext) {
  activeSelectionContext = context;
  activeAnchorRect = context.rect;
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.closeButton.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = ui("tooltipSentenceAnalysis");
  tooltip.analysisTriggerButton.style.display = "inline-flex";
  tooltip.analysisTriggerButton.textContent = ui("tooltipStartAnalysis");
  tooltip.analysisStatusEl.dataset.loading = "false";
  tooltip.analysisStatusEl.textContent = "";
  tooltip.analysisLoadingEl.dataset.visible = "false";
  tooltip.analysisView.dataset.phase = "idle";
  tooltip.analysisSourceEl.textContent = context.text;
  tooltip.analysisLegendEl.innerHTML = "";
  tooltip.analysisTranslationEl.textContent = "";
  tooltip.analysisStructureEl.textContent = "";
  tooltip.analysisStepsEl.innerHTML = "";
  tooltip.host.style.display = "block";
  analysisPanelOpen = false;
  positionSentenceAnalysisButton(context.rect);
}

function isPointerNearTooltip(clientX: number, clientY: number): boolean {
  if (tooltip.host.style.display !== "block") {
    return false;
  }

  const rect = tooltip.card.getBoundingClientRect();
  const padding = 18;

  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

function isPointerNearAnchor(clientX: number, clientY: number): boolean {
  if (!activeAnchorRect) {
    return false;
  }

  const padding = 22;

  return (
    clientX >= activeAnchorRect.left - padding &&
    clientX <= activeAnchorRect.right + padding &&
    clientY >= activeAnchorRect.top - padding &&
    clientY <= activeAnchorRect.bottom + padding
  );
}

function isPointerInTooltipCorridor(clientX: number, clientY: number): boolean {
  if (tooltip.host.style.display !== "block" || !activeAnchorRect) {
    return false;
  }

  const tooltipRect = tooltip.card.getBoundingClientRect();
  const padding = 18;
  const left = Math.min(activeAnchorRect.left, tooltipRect.left) - padding;
  const right = Math.max(activeAnchorRect.right, tooltipRect.right) + padding;
  const top = Math.min(activeAnchorRect.top, tooltipRect.top) - padding;
  const bottom = Math.max(activeAnchorRect.bottom, tooltipRect.bottom) + padding;

  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

function renderTooltip(result: LexiconLookupResult, rect: DOMRect) {
  const displayedProvider = result.translationProvider
    ? normalizeDisplayedTranslationProvider(result.translationProvider)
    : currentDefaultTranslationProvider;
  tooltip.card.dataset.mode = "word";
  tooltip.wordView.dataset.visible = "true";
  tooltip.analysisView.dataset.visible = "false";
  setWordTooltipControls("word");
  applySelectionTypography(null);
  tooltip.surfaceEl.textContent = result.surface;
  tooltip.surfacePosEl.textContent = result.partOfSpeech ?? "";
  tooltip.surfacePosEl.dataset.visible = result.partOfSpeech ? "true" : "false";
  setPrimaryTranslationContent(
    result.translation,
    result.contextualPartOfSpeech,
    result.translationProvider,
  );
  tooltip.secondaryTranslationEl.textContent = result.sentenceTranslation ?? "";
  tooltip.secondaryTranslationEl.dataset.visible = result.sentenceTranslation ? "true" : "false";
  resetEnglishExplanationDisplay();
  if (result.englishExplanation) {
    showEnglishExplanation(result.englishExplanation);
  }
  setTranslationPresentation(
    "word",
    result.translation,
    result.sentenceTranslation,
    result.englishExplanation,
  );
  tooltip.translationEl.dataset.visible = "true";
  tooltip.hintEl.dataset.visible = result.translation ? "false" : "true";
  tooltip.hintEl.dataset.loading = "false";
  if (!result.translation) {
    tooltip.hintEl.dataset.kind = "prompt";
    tooltip.hintEl.textContent = getTranslationActionPrompt(getAlternateTranslationProvider(displayedProvider));
    tooltip.secondaryTranslationEl.dataset.visible = "false";
  }
  setDisplayedTranslationProvider(displayedProvider);
  tooltip.rankEl.dataset.kind = "rank";
  tooltip.rankEl.dataset.rankLabel = rankLabel(result);
  tooltip.rankEl.textContent = tooltip.rankEl.dataset.rankLabel;
  tooltip.host.style.display = "block";
  activeAnchorRect = rect;
  activeSelectionTooltipContext = null;
  activeWordTooltipSource = activeContext?.forceTranslate ? "review-word" : "hover-word";
  positionTooltip(rect);
  activeResult = result;
  if (activePronunciationSurface !== result.surface) {
    resetPronunciationDisplay(result.surface);
    void loadPronunciation(result.surface);
  }
}

function renderSentenceAnalysisPanel(
  result: SentenceAnalysisResult,
  context: SentenceSelectionContext,
) {
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.closeButton.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = ui("tooltipSentenceAnalysis");
  tooltip.analysisTriggerButton.style.display = "none";
  tooltip.analysisStatusEl.textContent = "";
  tooltip.analysisStatusEl.dataset.loading = "false";
  tooltip.analysisLoadingEl.dataset.visible = "false";
  tooltip.analysisView.dataset.phase = "idle";
  tooltip.analysisSourceEl.innerHTML = renderSentenceWithClauseBlocks(result, context.text);
  tooltip.analysisLegendEl.innerHTML = renderLegendMarkup(result, context.text);
  tooltip.analysisTranslationEl.textContent = result.translation;
  tooltip.analysisStructureEl.textContent = result.structure;
  tooltip.analysisStepsEl.innerHTML = renderAnalysisStepsMarkup(result.analysisSteps);
  tooltip.host.style.display = "block";
  analysisPanelOpen = true;
  positionSentenceAnalysisPanel(context.rect);
  requestAnimationFrame(() => {
    if (tooltip.analysisView.dataset.visible === "true") {
      tooltip.analysisView.dataset.phase = "ready";
    }
  });
}

async function ensureSettings(): Promise<UserSettings> {
  if (currentSettings) {
    return currentSettings;
  }

  try {
    currentSettings = await getSettings();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      currentSettings = DEFAULT_SETTINGS;
      hideTooltip();
      clearHighlights();
      return currentSettings;
    }

    throw error;
  }

  return currentSettings;
}

async function refreshHighlights() {
  if (!supportsHighlights() || !document.body) {
    return;
  }

  const settings = await ensureSettings();
  const highlight = new Highlight();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node instanceof Text && !shouldSkipTextNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const matcher = createEnglishTokenMatcher();
  let pendingCount = 0;
  let currentNode = walker.nextNode();

  while (currentNode && pendingCount < HIGHLIGHT_SCAN_LIMIT) {
    const textNode = currentNode as Text;
    const text = textNode.textContent ?? "";
    matcher.lastIndex = 0;

    let match = matcher.exec(text);
    while (match && pendingCount < HIGHLIGHT_SCAN_LIMIT) {
      const surface = match[0];
      const start = match.index;
      const end = match.index + surface.length;

      if (isEmbeddedInTechnicalToken(text, start, end)) {
        match = matcher.exec(text);
        continue;
      }

      const segments = getHighlightSegments(surface, start);
      let highlightedSegment = false;

      for (const segment of segments) {
        if (pendingCount >= HIGHLIGHT_SCAN_LIMIT) {
          break;
        }

        const lemma = resolveLookupLemma(segment.surface);
        const rank = lemma ? lookupRank(lemma) : null;
        const contextText = getHighlightTokenContext(textNode, segment.start, segment.end, segment.surface);

        if (!shouldTranslateHighlightToken(segment.surface, lemma, rank, settings, contextText)) {
          continue;
        }

        const range = document.createRange();
        range.setStart(textNode, segment.start);
        range.setEnd(textNode, segment.end);
        const rect = range.getBoundingClientRect();

        if (isVisibleRect(rect)) {
          highlight.add(range);
          pendingCount += 1;
          highlightedSegment = true;
        }
      }

      if (!highlightedSegment) {
        const lemma = resolveLookupLemma(surface);
        const rank = lemma ? lookupRank(lemma) : null;
        const contextText = getHighlightTokenContext(textNode, start, end, surface);

        if (shouldTranslateHighlightToken(surface, lemma, rank, settings, contextText)) {
          const range = document.createRange();
          range.setStart(textNode, start);
          range.setEnd(textNode, end);
          const rect = range.getBoundingClientRect();

          if (isVisibleRect(rect)) {
            highlight.add(range);
            pendingCount += 1;
          }
        }
      }

      match = matcher.exec(text);
    }

    currentNode = walker.nextNode();
  }

  CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

function scheduleHighlightRefresh() {
  if (!supportsHighlights()) {
    return;
  }

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  highlightTimer = window.setTimeout(() => {
    void refreshHighlights();
  }, 220);
}

function clearSelectionTriggerTimer() {
  if (selectionTriggerTimer) {
    window.clearTimeout(selectionTriggerTimer);
    selectionTriggerTimer = null;
  }
}

function scheduleSelectionTriggerUpdate(delayMs = 0) {
  clearSelectionTriggerTimer();
  selectionTriggerTimer = window.setTimeout(() => {
    selectionTriggerTimer = null;
    updateSelectionAnalysisTrigger();
  }, delayMs);
}

function shouldTranslateHighlightToken(
  surface: string,
  lemma: string,
  rank: number | null,
  settings: UserSettings,
  contextText: string,
): boolean {
  const flags = resolveWordFlags(lemma, rank, settings, surface);

  if (!flags.shouldTranslate) {
    return false;
  }

  return !looksLikeContextualSpecialTerm(surface, contextText);
}

function getHighlightTokenContext(textNode: Text, start: number, end: number, fallback: string): string {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  return extractContextAroundDomRange(range, fallback);
}

async function resolveHoverWord(context: HoverContext) {
  let response: LookupWordResponse;

  try {
    response = await runtimeSend<LookupWordResponse>({
      type: "LOOKUP_WORD",
      payload: {
        surface: context.surface,
        forceTranslate: context.forceTranslate,
        contextText: context.contextText,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    hideTooltip();
    return;
  }

  if (context.requestId !== activeRequestId) {
    return;
  }

  if (!response.result.shouldTranslate) {
    hideTooltip();
    return;
  }

  activeContext = context;
  renderTooltip(response.result, context.rect);
  await requestTranslationForContext(currentDefaultTranslationProvider, context);
}

async function requestTranslation(provider: TranslationProviderChoice) {
  if (!activeContext) {
    return;
  }

  const requestContext = activeContext;
  setDisplayedTranslationProvider(provider);
  activeTranslationRequestId += 1;
  const translationRequestId = activeTranslationRequestId;
  const preservingPreviousResult = beginTranslationTransition();

  if (!preservingPreviousResult) {
    tooltip.translationEl.dataset.visible = "true";
    tooltip.translationEl.dataset.compact = "false";
    setPrimaryTranslationContent();
    tooltip.secondaryTranslationEl.textContent = "";
    tooltip.secondaryTranslationEl.dataset.visible = "false";
    resetEnglishExplanationDisplay();
  }
  showWordMetaStatus(provider === "llm" ? ui("tooltipContextTranslating") : ui("tooltipGoogleTranslating"));

  let response: LookupWordResponse;

  try {
    response = await runtimeSend<LookupWordResponse>({
      type: "TRANSLATE_WORD",
      payload: {
        surface: requestContext.surface,
        contextText: requestContext.contextText,
        forceTranslate: requestContext.forceTranslate,
        provider,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    if (translationRequestId === activeTranslationRequestId) {
      tooltip.translationEl.dataset.transition = "idle";
      restoreWordMetaRank();
      tooltip.hintEl.dataset.visible = "true";
      tooltip.hintEl.dataset.loading = "false";
      tooltip.hintEl.dataset.kind = "status";
      tooltip.hintEl.textContent = ui("tooltipTranslationUnavailable");
    }
    return;
  }

  if (
    translationRequestId !== activeTranslationRequestId ||
    !activeContext ||
    activeContext.requestId !== requestContext.requestId
  ) {
    return;
  }

  const result = response.result;
  activeResult = result;
  await animateTranslationSwap(() => {
    renderTooltip(result, requestContext.rect);
  });
}

async function requestSelectionTranslation(
  provider: TranslationProviderChoice,
  context = activeSelectionTooltipContext,
) {
  if (!context) {
    return;
  }

  activeSelectionTooltipContext = context;
  setDisplayedTranslationProvider(provider);
  activeSelectionTranslationRequestId += 1;
  const translationRequestId = activeSelectionTranslationRequestId;
  const preservingPreviousResult = beginTranslationTransition();

  if (!preservingPreviousResult) {
    renderSelectionTooltip(context);
    tooltip.translationEl.dataset.compact = "false";
  }
  tooltip.hintEl.dataset.loading = "true";
  tooltip.hintEl.dataset.kind = "status";
  tooltip.hintEl.textContent = provider === "llm" ? ui("tooltipContextTranslating") : ui("tooltipGoogleTranslating");

  if (!preservingPreviousResult) {
    resetEnglishExplanationDisplay();
  }

  let response: SelectionTranslationResponse;

  try {
    response = await runtimeSend<SelectionTranslationResponse>({
      type: "TRANSLATE_SELECTION",
      payload: {
        text: context.text,
        contextText: context.contextText,
        provider,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok || !response.result) {
    if (translationRequestId === activeSelectionTranslationRequestId) {
      tooltip.translationEl.dataset.transition = "idle";
      tooltip.hintEl.dataset.loading = "false";
      tooltip.hintEl.dataset.kind = "status";
      tooltip.hintEl.textContent = ui("tooltipTranslationUnavailable");
    }
    return;
  }

  if (
    translationRequestId !== activeSelectionTranslationRequestId ||
    !activeSelectionTooltipContext ||
    activeSelectionTooltipContext.requestId !== context.requestId
  ) {
    return;
  }

  const result = response.result;
  await animateTranslationSwap(() => {
    renderSelectionTooltip(context, {
      translation: result.translation,
      sentenceTranslation: result.sentenceTranslation,
      translationProvider: result.translationProvider,
    });
  });
}

async function requestTranslationForContext(
  provider: TranslationProviderChoice,
  context: HoverContext,
) {
  activeContext = context;
  await requestTranslation(provider);
}

function showPronunciationFeedback(button: HTMLButtonElement) {
  button.dataset.playing = "true";
  window.setTimeout(() => {
    button.dataset.playing = "false";
  }, 1200);
}

async function playPronunciationAudio(
  audioUrl: string,
  button: HTMLButtonElement,
): Promise<boolean> {
  try {
    stopActivePronunciationAudio();
    const audio = new Audio(audioUrl);
    activePronunciationAudio = audio;
    audio.preload = "auto";
    button.dataset.playing = "true";

    await audio.play();

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("abort", handleError);
      };
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("audio playback failed"));
      };

      audio.addEventListener("ended", handleEnded, { once: true });
      audio.addEventListener("error", handleError, { once: true });
      audio.addEventListener("abort", handleError, { once: true });
    });

    if (activePronunciationAudio === audio) {
      activePronunciationAudio = null;
    }
    button.dataset.playing = "false";
    return true;
  } catch {
    button.dataset.playing = "false";
    if (activePronunciationAudio) {
      activePronunciationAudio = null;
    }
    return false;
  }
}

async function speakPronunciation(accent: PronunciationAccent) {
  if (!activeResult?.surface || activeWordTooltipSource === "selection-translate") {
    return;
  }

  const button = accent === "en-GB" ? tooltip.britishButton : tooltip.americanButton;
  const audioUrl = accent === "en-GB"
    ? activePronunciationResult?.ukAudioUrl
    : activePronunciationResult?.usAudioUrl;

  let response: PronunciationResponse;

  showPronunciationFeedback(button);

  try {
    response = await runtimeSend<PronunciationResponse>({
      type: "SPEAK_PRONUNCIATION",
      payload: {
        text: activeResult.surface,
        accent,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (!response.ok) {
    button.dataset.playing = "false";

    if (audioUrl) {
      const played = await playPronunciationAudio(audioUrl, button);

      if (played) {
        return;
      }
    }

    tooltip.hintEl.dataset.visible = "true";
    tooltip.hintEl.dataset.loading = "false";
    tooltip.hintEl.textContent = response.error ?? ui("tooltipPronunciationUnavailable");
  }
}

async function requestSentenceAnalysis(context: SentenceSelectionContext) {
  activeSentenceAnalysisRequestId += 1;
  const requestId = activeSentenceAnalysisRequestId;
  activeSelectionContext = context;
  tooltip.card.dataset.mode = "analysis";
  tooltip.wordView.dataset.visible = "false";
  tooltip.analysisView.dataset.visible = "true";
  tooltip.closeButton.dataset.visible = "true";
  tooltip.analysisTitleEl.textContent = ui("tooltipSentenceAnalysis");
  tooltip.analysisTriggerButton.style.display = "none";
  tooltip.analysisStatusEl.dataset.loading = "true";
  tooltip.analysisStatusEl.textContent = "";
  tooltip.analysisLoadingEl.dataset.visible = "true";
  tooltip.analysisView.dataset.phase = "loading";
  tooltip.analysisSourceEl.textContent = context.text;
  tooltip.analysisLegendEl.innerHTML = "";
  tooltip.analysisTranslationEl.textContent = "";
  tooltip.analysisStructureEl.textContent = "";
  tooltip.analysisStepsEl.innerHTML = "";
  tooltip.host.style.display = "block";
  analysisPanelOpen = true;
  positionSentenceAnalysisPanel(context.rect);
  await waitForPaint();

  let response: SentenceAnalysisResponse;

  try {
    response = await runtimeSend<SentenceAnalysisResponse>({
      type: "ANALYZE_SELECTION",
      payload: {
        text: context.text,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (requestId !== activeSentenceAnalysisRequestId) {
    return;
  }

  if (!response.ok || !response.result) {
    tooltip.analysisStatusEl.dataset.loading = "false";
    tooltip.analysisLoadingEl.dataset.visible = "false";
    tooltip.analysisView.dataset.phase = "idle";
    tooltip.analysisStatusEl.textContent = response.error ?? ui("tooltipSentenceAnalysisUnavailable");
    return;
  }

  renderSentenceAnalysisPanel(response.result, context);
}

async function markWordForReview(surface: string): Promise<boolean> {
  const lemma = resolveLookupLemma(surface);
  const rank = lemma ? lookupRank(lemma) : null;
  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_UNMASTERED",
      payload: {
        lemma,
        rank,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return false;
    }

    throw error;
  }

  if (!response.ok) {
    return false;
  }

  currentSettings = response.settings ?? currentSettings;
  await refreshHighlightsNow();
  return true;
}

function scheduleLookup(context: HoverContext) {
  if (hoverTimer) {
    window.clearTimeout(hoverTimer);
  }

  hoverTimer = window.setTimeout(() => {
    void resolveHoverWord(context);
  }, HOVER_DELAY_MS);
}

function isSameHoverTarget(context: HoverContext): boolean {
  if (!activeContext || !activeAnchorRect) {
    return false;
  }

  return (
    activeContext.surface === context.surface &&
    Math.abs(activeAnchorRect.left - context.rect.left) < 1 &&
    Math.abs(activeAnchorRect.top - context.rect.top) < 1 &&
    Math.abs(activeAnchorRect.width - context.rect.width) < 1 &&
    Math.abs(activeAnchorRect.height - context.rect.height) < 1
  );
}

function getHoverContext(clientX: number, clientY: number): HoverContext | null {
  const caret = getCaretRangeFromPoint(clientX, clientY);

  if (!caret || isIgnoredContainer(caret.node)) {
    return null;
  }

  const text = caret.node.textContent ?? "";
  const word = extractWordAtOffset(text, caret.offset);

  if (!word) {
    return null;
  }

  const range = document.createRange();
  range.setStart(caret.node, word.start);
  range.setEnd(caret.node, word.end);

  const rect = range.getBoundingClientRect();

  if (!rect.width && !rect.height) {
    return null;
  }

  const horizontalPadding = 1;
  const verticalPadding = 2;

  if (
    clientX < rect.left - horizontalPadding ||
    clientX > rect.right + horizontalPadding ||
    clientY < rect.top - verticalPadding ||
    clientY > rect.bottom + verticalPadding
  ) {
    return null;
  }

  activeRequestId += 1;

  return {
    surface: word.surface,
    rect,
    requestId: activeRequestId,
    contextText: extractSentenceAroundRange(text, word.start, word.end),
  };
}

function updateSelectionAnalysisTrigger() {
  if (Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  const context = getSelectedTextContext();

  if (!context) {
    const hadAnalysisOpen = analysisPanelOpen;
    const hadSelectionOpen = Boolean(activeSelectionTooltipContext);
    hideSentenceAnalysis();
    if (hadAnalysisOpen || hadSelectionOpen) {
      hideTooltip();
    }
    return;
  }

  cancelActiveAsyncRequests();
  hideSentenceAnalysis();
  renderSelectionTooltip(context);
  void requestSelectionTranslation(currentDefaultTranslationProvider, context);
}

tooltip.card.addEventListener("mouseenter", () => {
  tooltipHovered = true;
  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }
});

tooltip.card.addEventListener("mouseleave", () => {
  tooltipHovered = false;
  scheduleHide();
});

tooltip.closeButton.addEventListener("click", () => {
  window.getSelection()?.removeAllRanges();
  hideSentenceAnalysis();
  hideTooltip();
});

tooltip.analysisTriggerButton.addEventListener("mousedown", (event) => {
  event.preventDefault();
  suppressSelectionTriggerUntil = Date.now() + 800;
});

tooltip.analysisTriggerButton.addEventListener("click", async () => {
  if (!activeSelectionContext) {
    return;
  }

  suppressSelectionTriggerUntil = Date.now() + 1500;
  await requestSentenceAnalysis(activeSelectionContext);
});

[tooltip.llmButton, tooltip.selectionAnalysisButton, tooltip.ignoreButton, tooltip.button].forEach((actionButton) => {
  actionButton.addEventListener("mouseenter", () => {
    syncActionIndicator(actionButton);
  });
  actionButton.addEventListener("focus", () => {
    syncActionIndicator(actionButton);
  });
});

tooltip.actionsEl.addEventListener("mouseleave", () => {
  syncActionIndicator();
});

tooltip.selectionAnalysisButton.addEventListener("click", async () => {
  if (!activeSelectionContext) {
    return;
  }

  if (!isAnalyzableSelectionText(activeSelectionContext.text)) {
    tooltip.hintEl.dataset.visible = "true";
    tooltip.hintEl.dataset.loading = "false";
    tooltip.hintEl.textContent = ui("tooltipShortSelectionHint");
    return;
  }

  suppressSelectionTriggerUntil = Date.now() + 1500;
  cancelActiveAsyncRequests();
  await requestSentenceAnalysis(activeSelectionContext);
});

tooltip.button.addEventListener("click", async () => {
  if (!activeResult?.lemma) {
    return;
  }

  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_MASTERED",
      payload: {
        lemma: activeResult.lemma,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (response.ok) {
    currentSettings = response.settings ?? currentSettings;
    activeRequestId += 1;
    hideTooltip();
    await refreshHighlightsNow();
  }
});

tooltip.llmButton.addEventListener("click", async () => {
  const provider = tooltip.llmButton.dataset.provider === "google" ? "google" : "llm";

  if (activeSelectionTooltipContext) {
    await requestSelectionTranslation(provider, activeSelectionTooltipContext);
    return;
  }

  await requestTranslation(provider);
});

tooltip.britishButton.addEventListener("click", async () => {
  await speakPronunciation("en-GB");
});

tooltip.americanButton.addEventListener("click", async () => {
  await speakPronunciation("en-US");
});

tooltip.ignoreButton.addEventListener("click", async () => {
  if (!activeResult?.lemma) {
    return;
  }

  let response: SettingsResponse;

  try {
    response = await runtimeSend<SettingsResponse>({
      type: "SET_WORD_IGNORED",
      payload: {
        lemma: activeResult.lemma,
      },
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      hideTooltip();
      return;
    }

    throw error;
  }

  if (response.ok) {
    currentSettings = response.settings ?? currentSettings;
    activeRequestId += 1;
    hideTooltip();
    await refreshHighlightsNow();
  }
});

document.addEventListener(
  "mousemove",
  (event) => {
    const path = event.composedPath();
    if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
      return;
    }

    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    if (isPersistentTooltipSession()) {
      return;
    }

    const context = getHoverContext(event.clientX, event.clientY);
    const pointerProtected =
      tooltip.host.style.display === "block" &&
      (isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY) ||
        isPointerInTooltipCorridor(event.clientX, event.clientY));

    if (pointerProtected && context && isSameHoverTarget(context)) {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
      return;
    }

    if (!context) {
      if (
        isPointerNearTooltip(event.clientX, event.clientY) ||
        isPointerNearAnchor(event.clientX, event.clientY) ||
        isPointerInTooltipCorridor(event.clientX, event.clientY)
      ) {
        return;
      }

      if (tooltip.host.style.display === "block") {
        scheduleHide();
        return;
      }

      scheduleHide();
      return;
    }

    scheduleLookup(context);
  },
  { passive: true },
);

document.addEventListener("mouseup", (event) => {
  const path = event.composedPath();

  if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
    return;
  }

  pointerSelecting = false;

  if (event.detail === 2) {
    suppressSelectionTriggerUntil = Date.now() + 500;
    return;
  }

  scheduleSelectionTriggerUpdate();
});

document.addEventListener("keyup", (event) => {
  if (Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  const key = event.key ?? "";

  if (key === "Shift" || key.startsWith("Arrow")) {
    scheduleSelectionTriggerUpdate();
  }
});

document.addEventListener("selectionchange", () => {
  if (pointerSelecting || Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  scheduleSelectionTriggerUpdate(SELECTION_TRIGGER_DEBOUNCE_MS);
});

window.addEventListener("pointerup", () => {
  if (!pointerSelecting) {
    return;
  }

  pointerSelecting = false;

  if (Date.now() < suppressSelectionTriggerUntil) {
    return;
  }

  scheduleSelectionTriggerUpdate();
}, { passive: true });

document.addEventListener("dblclick", (event) => {
  window.setTimeout(() => {
    const context = getSelectedWordContext({
      clientX: event.clientX,
      clientY: event.clientY,
    });

    if (!context) {
      return;
    }

    void (async () => {
      const changed = await markWordForReview(context.surface);

      if (!changed) {
        return;
      }

      window.getSelection()?.removeAllRanges();

      await resolveHoverWord(context);
    })();
  }, 0);
});

document.addEventListener(
  "scroll",
  () => {
    if (tooltip.host.style.display === "block" && !isPersistentTooltipSession()) {
      hideTooltip();
      hideSentenceAnalysis();
    }

    scheduleHighlightRefresh();
  },
  { capture: true, passive: true },
);

window.addEventListener("resize", () => {
  if (activeSelectionTooltipContext && tooltip.host.style.display === "block") {
    positionTooltip(activeSelectionTooltipContext.rect);
  }

  if (analysisPanelOpen && activeSelectionContext) {
    positionSentenceAnalysisPanel(activeSelectionContext.rect);
  } else if (activeSelectionContext) {
    positionSentenceAnalysisButton(activeSelectionContext.rect);
  }
  scheduleHighlightRefresh();
});

window.addEventListener("blur", () => {
  pointerSelecting = false;
  hideTooltip();
  hideSentenceAnalysis();
});

window.addEventListener("focus", () => {
  scheduleHighlightRefresh();
});

document.addEventListener("pointerdown", (event) => {
  const path = event.composedPath();

  if (path.includes(tooltip.host) || path.includes(tooltip.card)) {
    return;
  }

  pointerSelecting = true;
  clearSelectionTriggerTimer();
  hideTooltip();
  hideSentenceAnalysis();
});

void refreshLearnerLanguage();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(STORAGE_TRANSLATOR_SETTINGS_KEY in changes)) {
    return;
  }

  void refreshLearnerLanguage().then(() => {
    cancelActiveAsyncRequests();
    if (tooltip.host.style.display === "block") {
      hideTooltip();
      hideSentenceAnalysis();
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideTooltip();
    hideSentenceAnalysis();
  }
});

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  if ((areaName !== "sync" && areaName !== "local") || !changes.userSettings) {
    return;
  }

  currentSettings = (changes.userSettings.newValue as UserSettings | undefined) ?? DEFAULT_SETTINGS;
  scheduleHighlightRefresh();
});

const mutationObserver = new MutationObserver(() => {
  scheduleHighlightRefresh();
});

function startObservers() {
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startObservers();
    scheduleHighlightRefresh();
  });
} else {
  startObservers();
  scheduleHighlightRefresh();
}
