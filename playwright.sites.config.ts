import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/sites",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { outputFolder: "playwright-site-report", open: "never" }],
      ]
    : [["list"]],
  use: {
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results/site-smoke",
});
