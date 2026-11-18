import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

// End-to-end tests run against an already-running stack (API + worker + web) with DEMO_MODE on.
// See the e2e section in apps/web/README.md.
//
// CI mode: CI set to anything non-empty, or `npm run test:e2e:ci` (which sets CI=1 here, since an
// npm script can't set a variable portably on Windows and Unix). CI mode retries a failed test
// once, writes an HTML report next to the list output, and uses Playwright's Chromium.
//
// Environment:
//   E2E_BASE_URL         the web app (default http://127.0.0.1:3000)
//   E2E_BROWSER_CHANNEL  "msedge", "chrome", or "" for Playwright's Chromium (default: Chromium in
//                        CI; system Edge on Windows, where Playwright's Chromium isn't installed)
//   E2E_OUTPUT_DIR       traces, failure screenshots and videos (default test-results)
//   E2E_REPORT_DIR       the HTML report in CI mode (default playwright-report)
//   E2E_SCREENSHOT_DIR   the specs' named screenshots (default test-results/screenshots, helpers.ts)
//   E2E_DEMO_PASSWORD    the demo password, else the file in E2E_PASSWORD_FILE or
//                        .data/demo-password.txt (helpers.ts)
if (process.env.npm_lifecycle_event === "test:e2e:ci" && !process.env.CI) process.env.CI = "1";
const isCI = Boolean(process.env.CI);

const channel = process.env.E2E_BROWSER_CHANNEL ?? (!isCI && process.platform === "win32" ? "msedge" : "");

const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  channel: channel || undefined,
};

const reporter: ReporterDescription[] = isCI
  ? [["list"], ["html", { outputFolder: process.env.E2E_REPORT_DIR || "playwright-report", open: "never" }]]
  : [["list"]];

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // One worker: the demo accounts are shared, and the sign-in limits are per IP.
  fullyParallel: false,
  workers: 1,
  // A stray test.only must not shrink a CI run to one test.
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter,
  outputDir: process.env.E2E_OUTPUT_DIR || "test-results",
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
