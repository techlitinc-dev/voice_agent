import { defineConfig, devices } from "@playwright/test";

/**
 * Vaani AI E2E config. The app must already be running (npm run dev on :3000,
 * or a prod build). Override the target with E2E_BASE_URL.
 * Auth sessions are cached in e2e/.auth/ via the storageState pattern
 * (see helpers.ts — specs call loginDemo()/loginViaUi() which reuse it).
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // specs share one DB (demo workspace) — run serially
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
