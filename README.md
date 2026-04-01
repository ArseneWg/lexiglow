# LexiGlow

LexiGlow is a Chrome extension that helps you learn English vocabulary while you work on real web pages.

It highlights unfamiliar English words with a soft yellow glow, shows Chinese translations on hover, and lets you gradually grow your known-word set without breaking the original page layout.

## Features

- Hover an unfamiliar English word to see a Chinese translation
- Set a dynamic "known top N words" threshold
- Click `已掌握` to remove a word from future translations
- Double-click a word to force it back into review mode
- Skip product names, brands, and obvious proper nouns by default
- Keep page layout intact by using overlay UI and native highlights

## How It Works

- Uses the `google-10000-english` frequency list as the base lexicon
- Treats the top configured words as already known
- Stores your mastered, unmastered, and ignored words in Chrome sync storage
- Uses a lightweight Google web translate provider for the initial prototype

## Development

```bash
npm install
npm run fetch:lexicon
npm run build
npm test
```

Load the unpacked extension from `dist` in Chrome, or load the project root after build.

## Validation

- `npm test`
- `npm run build`

## License

MIT
