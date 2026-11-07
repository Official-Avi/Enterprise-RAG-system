import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against an already-running stack (API + worker + web) with DEMO_MODE on.
// See the e2e section in apps/web/README.md.

// The browser: system Edge on Windows (Playwright's own Chromium download isn't installed there),
// otherwise Playwright's Chromium. E2E_BROWSER_CHANNEL overrides it, e.g. "chrome", or "" for
// Playwright's Chromium on Windows too.
const channel = process.env.E2E_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "");

const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  channel: channel || undefined,
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One worker: the demo accounts are shared, and the sign-in limits are per IP.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Signs each demo persona in once and saves the session to e2e/.auth/<persona>.json.
    { name: "setup", testMatch: /.*\.setup\.ts/, use: desktop },
    { name: "chromium", use: desktop, dependencies: ["setup"] },
  ],
});
