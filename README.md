# LexiGlow

![LexiGlow banner](./assets/lexiglow-banner.svg)

<p align="center">
  Learn English vocabulary in the wild, directly on real web pages.
</p>

<p align="center">
  <a href="https://github.com/xiaoyao888888/lexiglow/stargazers">
    <img alt="GitHub stars" src="https://img.shields.io/github/stars/xiaoyao888888/lexiglow?style=flat-square" />
  </a>
  <a href="https://github.com/xiaoyao888888/lexiglow/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/xiaoyao888888/lexiglow?style=flat-square" />
  </a>
  <img alt="Chrome Extension" src="https://img.shields.io/badge/platform-Chrome%20Extension-f6c453?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/built%20with-TypeScript-2f74c0?style=flat-square" />
</p>

LexiGlow is a Chrome extension for context-based English learning. It highlights words you still need to learn, shows Chinese translations on hover, and lets you gradually grow your personal vocabulary while reading real articles, docs, newsletters, and product pages.

It now also includes long-sentence analysis for selected English passages, so you can move from single-word comprehension to full sentence structure understanding without leaving the page.

It is designed to feel lightweight:

- no DOM wrapping of page text
- no broken page layout
- no aggressive full-page rewriting
- just a soft yellow glow, a hover card, and progressive vocabulary tracking

## Why It Feels Different

Most vocabulary tools either interrupt your reading flow or force you into a separate app.

LexiGlow keeps learning inside your normal workflow:

- Hover unfamiliar words to get instant Chinese translations
- Use Google by default, then switch to LLM when you want a better context-aware explanation
- Click `已掌握` to retire a word from future prompts
- Double-click a word to bring it back into review mode when you forget it
- Select a long English sentence and open a guided sentence analysis in the same tooltip
- Dynamically configure how many high-frequency words you already know
- Skip obvious proper nouns, brand names, and product terms by default

## Core Features

- Dynamic known-word threshold based on the Google 10,000 English word frequency list
- Manual mastered list that keeps growing over time
- Manual review mode for forgotten words
- Ignored-word logic for names, brands, and non-learning targets
- Default Google translation with optional LLM refinement
- Configurable LLM display mode:
  - word-only translation
  - word translation plus full sentence translation
- Long-sentence analysis for selected English passages
- Color-coded key-word highlighting for sentence structure:
  - subject
  - predicate
  - non-finite verbs
  - conjunctions
  - relative words
  - prepositions
- Current-page synchronization: once a word is marked mastered, matching highlights disappear right away
- Toolbar popup with learning stats and quick controls
- Full settings page for search, overrides, and cleanup

## How It Works

LexiGlow combines a few simple ideas:

1. Start from a ranked 10k English frequency list
2. Treat the top `N` words as already known
3. Highlight only words that are still worth learning
4. Let your own actions override the defaults
5. Use lightweight hover translation for flow, and LLM analysis only when you explicitly ask for more depth

Your personal vocabulary state is stored in Chrome storage:

- `knownBaseRank` for the default high-frequency threshold
- `masteredOverrides` for words you have learned
- `unmasteredOverrides` for words you want to relearn
- `ignoredWords` for terms that should never trigger translation

Translator settings are stored locally in the browser, including:

- compatible OpenAI-style `base_url`
- `model`
- local API key
- Google fallback toggle
- LLM display mode

## Interaction Model

- Hover a highlighted word: see a Chinese translation
- Click `LLM 翻译`: replace the default result with a more context-aware explanation
- Click `已掌握`: remove it from the active learning set
- Click `永不翻译`: permanently ignore names, brands, handles, and other non-learning targets
- Double-click an English word: force it back into review mode
- Select a long English sentence, then click `长难句分析`: get a guided breakdown in the same tooltip
- Click the extension icon: check stats and adjust the threshold quickly

Long-sentence analysis is designed around a practical exam-style reading flow:

1. Cut the sentence into layers using conjunctions, relative words, and punctuation
2. Find the sentence backbone by locating the main subject and predicate
3. Separate branches such as non-finite verbs, prepositional phrases, and subordinate clauses
4. Reorganize the whole sentence into natural Chinese

## Install for Development

```bash
npm install
npm run fetch:lexicon
npm run build
npm test
```

Then load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select either:
   - the project root after build, or
   - the `dist` folder

## Tech Stack

- TypeScript
- Vite
- esbuild
- Chrome Manifest V3
- Native CSS Highlights API where available
- Google web translation prototype
- OpenAI-compatible LLM provider support

## Current Limitations

- Chrome-focused for now
- Uses a lightweight Google web translate prototype instead of an official paid API
- Long-sentence analysis quality depends on the configured LLM
- Sentence highlighting uses a mix of LLM tags and local heuristics, so it is helpful but not full syntactic parsing
- Highlighting is intentionally conservative to avoid breaking layout

## Roadmap

- Better proper-noun and named-entity filtering
- Better sentence-structure highlighting and clause grouping
- Cleaner tooltip interactions and richer feedback states
- Optional personal export/import of learning progress
- Smarter translation providers and caching strategies
- Chrome Web Store packaging and release automation

## Validation

- `npm test`
- `npm run build`

## License

MIT
