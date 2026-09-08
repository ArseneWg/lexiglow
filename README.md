# LexiGlow | Learn English Inside Your Workflow

[简体中文说明](./README.zh-CN.md)

![LexiGlow banner showing the in-page tooltip workflow](./assets/lexiglow-banner-en.svg)

<p align="center">
  Start with a fast Google result, expand to contextual translation only when needed, and keep review, pronunciation, English explanations, and sentence analysis inside the page you are already reading.
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

## What LexiGlow Is

LexiGlow is a Chrome extension for learning English while reading real pages on the web. Instead of pushing you into a separate flashcard flow, it overlays lookup, review, pronunciation, contextual translation, English explanations, and long-sentence analysis directly on top of your normal reading.

It is designed for reading situations like these:

- Hover an unfamiliar word or useful multi-word expression and get a fast default translation first.
- Expand to contextual translation only when the default result is not precise enough.
- Double-click a word you used to know and bring it back into review.
- Read a simple English explanation adapted to your current vocabulary range.
- Break down a difficult sentence inside the same tooltip without leaving the page.

## Why It Is Built This Way

- Lightweight by default, deeper help on demand.
  Google handles the quick first pass, which is faster and cheaper. You only spend LLM calls when the context really matters.
- Reading flow stays uninterrupted.
  Hover lookup, selection translation, pronunciation, and sentence analysis all happen in place.
- Explanations adapt to your level.
  The English explanation mode takes your known-word range into account and tries to stay readable.
- Learner language support is built in.
  Translation output and extension UI can follow one of the built-in learner languages instead of staying fixed to Chinese.
- Learning state respects user intent.
  Frequency rank is only an initial estimate. Explicit Known, Review, and Ignore actions override automatic assumptions.

## Learning Engine

LexiGlow treats automatic vocabulary detection as a conservative helper rather than an authority:

- **Confidence-based word families.** High-confidence regular forms and safe irregular forms share learning state (`work / worked / working`, `go / went`, `write / written`). Ambiguous lexical forms are deliberately kept separate when merging could corrupt progress (`lives`, `saw`, `left`, `rose`).
- **Compounds and phrases.** Hyphenated compounds such as `mixed-precision` are treated as lexical units. A curated layer of high-value expressions such as `account for`, `carry out`, and `take into account` can also become learning targets.
- **Article-local importance.** Repeated unfamiliar words in the current article receive higher visual priority, so frequently recurring vocabulary is easier to notice.
- **Spaced exposure for relearning.** A Review word starts strongly highlighted, then can soften as exposures accumulate. Well-exposed words can temporarily rest between review intervals and become strong again when due. Explicitly marking a word Known is still the only action that completes relearning.
- **Low-noise special-term filtering.** Strong identifier, handle, and romanized-name signals can be ignored automatically, but capitalization or word length alone no longer suppresses potentially useful vocabulary.

## Translation And Sentence Analysis

- Active selections always respect the user's translation intent; automatic proper-name heuristics do not silently block a manually selected phrase.
- Selection source text and surrounding context are handled separately. The selected source is preserved up to the 1200-character UI limit instead of being silently truncated to the short context window.
- Context extraction prefers sentence segmentation across inline DOM elements, using `Intl.Segmenter` when available and a punctuation fallback otherwise.
- Sentence analysis uses indexed source tokens so repeated words such as multiple instances of `that` can be highlighted at the correct occurrence.
- Structural output is validated before display. Incomplete clause coverage or weak structural signals trigger one stricter retry; a second structurally invalid result is rejected instead of being shown as trustworthy analysis.
- Single-token grammar highlights are labeled as structural heads (`Subject head`, `Main verb`); full clause relationships are represented by clause blocks.

## Core Features

- Hover lookup with a fast default translation
- On-demand contextual translation when the default answer is not enough
- Multiple LLM providers: OpenAI / compatible, Gemini, and Claude
- Double-click to bring forgotten words back into review
- Familiarity-aware relearning with controlled highlight exposure
- Simple English explanations tuned to the learner's vocabulary level
- Selection translation for words, phrases, and full sentences
- UK / US pronunciation with IPA and click-to-play
- In-tooltip long-sentence analysis with clause blocks, structure hints, translation, and reasoning steps
- Persistent learning state for known words, review words, and ignored words
- Confidence-based inflection and irregular-form mastery
- Curated multi-word-expression detection
- Built-in learner-language support for:
  `zh-CN`, `zh-TW`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `ru`, `it`, `tr`, `vi`, `id`, `th`, `ar`

![LexiGlow workflow from hover lookup to sentence analysis](./assets/lexiglow-workflow-en.svg)

## Install And Run

```bash
npm install
npm run fetch:lexicon
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repo root or `dist`

Recommended quick check:

1. Open an English webpage
2. Hover a highlighted word or supported expression and confirm the tooltip appears
3. Double-click a word and confirm it can be brought back into review
4. Select a phrase or sentence and confirm the default translation appears first
5. Click `Context Translate` and confirm you get a more context-aware result, or a simple English explanation depending on your settings
6. Click `Sentence Analysis` and confirm the panel shows clause blocks, backbone, translation, and analysis steps
7. Open the settings page and confirm you can switch learner language plus `OpenAI / Compatible`, `Gemini`, and `Claude`

The A1-C1 labels used for explanation simplicity are vocabulary-count heuristics, not a formal CEFR assessment.

## Quality Gate

Pull requests run reproducible dependency installation, a high-severity dependency audit, lexicon generation, TypeScript typechecking, unit tests, and the production extension build. Browser behavior should still be manually smoke-tested on representative article and SPA pages before a release, especially after changes to content-script interactions.

## Privacy And Provider Data

LexiGlow reads page text locally to identify English learning targets. Text is sent to a translation or LLM provider only when a translation or analysis request requires it. API keys are kept in extension-origin secret storage rather than exposed in content-script settings. If you configure a third-party or local provider, that provider's own privacy and retention policy applies to text sent to it.

## License And Commercial Use

LexiGlow currently uses a source-available license. It is not MIT and not a traditional permissive open-source license.

- Non-commercial learning, research, testing, and teaching use is allowed
- Commercial use requires prior written authorization from the author
- If you modify, port, adapt, or substantially rewrite this project, you must provide clear attribution to the original source

See:

- [LICENSE](./LICENSE)
- [COMMERCIAL.md](./COMMERCIAL.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

The bundled/fetched word-frequency data has its own upstream provenance and commercial-use caveat documented in `THIRD_PARTY_NOTICES.md`. A commercial LexiGlow license does not automatically grant separate third-party data rights.

If you want to use LexiGlow in a product, company workflow, paid service, enterprise deployment, or client delivery, contact the rights holder first and verify the third-party data terms as well.
