# Live Site Smoke Tests

The deterministic extension E2E suite remains the required regression gate. Live public-site smoke tests are intentionally isolated because external pages can change, rate-limit CI traffic, or temporarily fail independently of LexiGlow.

Run locally with:

```bash
npm run build
npm run test:e2e:sites
```

Current live targets cover GitHub, Hacker News, Reddit when CI egress is accepted, MDN long-form documentation, a web.dev article, and React documentation client-side navigation. Failed site-smoke runs retain Playwright traces, screenshots, HTML reports, and test results. Reddit 403/429 or bot-challenge responses are reported as skipped rather than as LexiGlow regressions.
