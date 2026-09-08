# LexiGlow | Learn English inside your reading flow

[简体中文](./README.zh-CN.md)

![LexiGlow banner showing the in-page tooltip workflow](./assets/lexiglow-banner.svg)

<p align="center">
  Fast Google lookup by default. Contextual LLM help, review, English explanations, pronunciation, and sentence analysis stay on the page when you need them.
</p>

<p align="center">
  <a href="https://github.com/ArseneWg/lexiglow/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/ArseneWg/lexiglow?style=flat-square" />
  </a>
  <a href="https://github.com/ArseneWg/lexiglow/blob/main/LICENSE">
    <img alt="Source Available" src="https://img.shields.io/badge/license-source--available-cb7a33?style=flat-square" />
  </a>
  <a href="https://github.com/ArseneWg/lexiglow/blob/main/COMMERCIAL.md">
    <img alt="Commercial License Required" src="https://img.shields.io/badge/commercial-license%20required-b3261e?style=flat-square" />
  </a>
  <img alt="Chrome Extension" src="https://img.shields.io/badge/platform-Chrome%20Extension-f6c453?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/built%20with-TypeScript-2f74c0?style=flat-square" />
</p>

## What is LexiGlow?

LexiGlow is a Chrome extension for learning English while reading. It keeps lookup, review, pronunciation, contextual translation, English explanations, and complex-sentence analysis inside the page instead of forcing a separate study workflow.

Typical reading flows include:

- Hover an unfamiliar highlighted word for a fast default translation.
- Switch to contextual translation only when the quick result is insufficient.
- Put a previously learned word back into review when you forget it.
- Request a simple-English explanation adapted to your estimated vocabulary size.
- Select a phrase or sentence for translation and analyze structurally difficult sentences in the same tooltip.

## Why it is designed this way

- Fast by default, richer on demand: Google handles the quick path; LLM requests are reserved for context-sensitive or explanatory tasks.
- Stay in the reading flow: lookup, selection translation, pronunciation, review, and sentence analysis happen in-page.
- Adapt explanation difficulty: English explanations use the learner's known-vocabulary estimate to avoid unnecessary unknown words.
- Multilingual learner UI: both translations and interface language follow the configured learner language.

The internal A1-C1 labels are vocabulary-size heuristics used to tune explanation difficulty. They are not a formal CEFR assessment.

## Core capabilities

- Hover lookup with a quick default Google translation.
- On-demand contextual LLM translation.
- OpenAI / Compatible, Gemini, and Claude provider profiles.
- Known, relearning, and ignored vocabulary states.
- Familiarity-aware spaced highlight exposure.
- Simple-English explanations adapted to the learner's estimated level.
- Selected-word, phrase, sentence, and paragraph translation.
- UK / US pronunciation metadata and playback.
- Sentence analysis with clause blocks, source-token highlighting, backbone structure, and translation order.
- Confidence-based morphology for common inflections and irregular forms while avoiding unsafe merges.
- Multi-word expression recognition, including inflected phrase variants.
- Hyphenated compounds treated as lexical units.
- 15 learner languages: `zh-CN`, `zh-TW`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `ru`, `it`, `tr`, `vi`, `id`, `th`, `ar`.

![LexiGlow workflow from hover lookup to sentence analysis](./assets/lexiglow-workflow.svg)

## Browser-level regression tests

In addition to unit tests, the project uses Playwright to launch a real persistent Chromium profile with the MV3 extension loaded. The browser suite exercises the service worker, content script, Shadow DOM tooltip, CSS Highlight API, selections, Popup / Options, dynamic DOM updates, and persisted learning state.

The current suite contains 30 user-facing Chromium scenarios. In addition to the original reading-flow coverage, it now verifies Options backup/download/import, API-key redaction and same-profile secret preservation, LLM 429 and malformed-response fallback, explicit 401 failure UI without fallback, stale hover-response suppression, and prevention of late responses resurrecting a closed tooltip.

The verified CI baseline is 17 Vitest files / 158 unit tests plus 30 / 30 Playwright Chromium extension E2E tests. Translation, dictionary, and LLM traffic is deterministically mocked at BrowserContext level so CI does not depend on real API keys or model randomness. Failed E2E runs retain Playwright traces, screenshots, HTML reports, and test-result diagnostics for investigation. A separate non-blocking public-site smoke workflow continues to exercise GitHub, Hacker News, MDN, web.dev, React docs, and Reddit when its CI egress is accepted.

## Long-term data safety and release artifacts

- User learning settings now carry an explicit schema version. Older local records are sanitized and migrated to schema v2 once; records from a newer schema are never overwritten merely by reading them from an older build.
- Options includes Backup and restore. The export contains long-term learning state and non-secret translator profile settings. API keys are always redacted from the JSON backup.
- Import validates the LexiGlow backup format/version and size, sanitizes legacy-shaped settings, and preserves an existing local API key only when the imported profile has the same profile ID.
- `npm run release:package` emits `release/lexiglow-<version>.zip` plus `SHA256SUMS`. The package contains only `manifest.json` and production `dist/**` files, and fails if `package.json` and the manifest disagree on version or if a manifest-referenced runtime file is missing.
- PR CI packages the same source twice and requires identical SHA256 output. Tag releases additionally require `vX.Y.Z` to match `package.json`, then run the full unit/build/browser gate before uploading the ZIP artifact.
- Tooltip lifecycle state is represented explicitly as hidden, hover-word, review-word, selection, analysis-prompt, or analysis instead of independent booleans/string flags that could drift apart during async interactions.

## Privacy and third-party services

- LLM API keys are kept in extension-origin private storage instead of page-readable translator configuration.
- Quick translation sends the selected source text to the configured Google Translate endpoint.
- Contextual translation, English explanations, and sentence analysis send relevant source/context text to the configured LLM provider.
- LexiGlow does not require those translation requests to pass through a LexiGlow-hosted backend.

If the page contains sensitive information, review the data-processing terms of the translation or LLM provider before sending that content.

## Build and install

```bash
npm install
npm run fetch:lexicon
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select the project root or `dist` output as appropriate for your local workflow.

Suggested smoke test:

1. Open an English page.
2. Hover a highlighted word and verify the tooltip appears.
3. Double-click a known word and put it back into review.
4. Select a phrase or full sentence and verify default translation.
5. Switch to Context Translate and verify the contextual result or English explanation.
6. Run Sentence Analysis on a difficult sentence.
7. Open settings and verify learner-language plus OpenAI / Compatible, Gemini, and Claude configuration.

Known state applies to safe common inflections such as `work / works / worked / working`, while derived forms such as `worker` or `workable` remain independent.

## License and commercial use

LexiGlow uses a source-available license rather than MIT or another conventional permissive open-source license.

- Non-commercial learning, research, testing, and educational use is permitted under the project license.
- Commercial use requires prior written authorization from the rights holder.
- Modified, ported, translated, or otherwise derivative versions that are substantially based on this project must retain the required attribution.

See:

- [LICENSE](./LICENSE)
- [COMMERCIAL.md](./COMMERCIAL.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

The bundled word-frequency data has separate upstream rights considerations. A commercial LexiGlow license does not automatically grant commercial rights to that third-party data; review `THIRD_PARTY_NOTICES.md` before commercial distribution.

### Pronunciation accuracy pipeline

LexiGlow treats pronunciation as a lexical-reading problem rather than a spelling-only TTS action. Exact single-word selections receive UK/US pronunciation when available. Structured Kaikki/Wiktextract pronunciation variants are kept atomic (IPA, audio/audio-IPA, accent/POS tags), pinned offline CMUdict/Britfone subsets for the top 5,000 frequency words plus explicit edge cases provide bounded reproducible fallback data, common heteronyms are resolved from context/POS when confidence is high, and regular -s/-ed/-ing forms can be derived from the base phonemes without reusing base-word audio. Human lexical audio is played before Chrome TTS; TTS always receives the exact selected surface and is disabled for unresolved ambiguous heteronyms. Source IPA is displayed without destructive DJ-style conversion.
