import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { loadLocalCiEnv, LOCAL_CI_APP_PORT } from "./qa/local-ci/env.mjs";

// e2e-local: the production build against a throwaway `supabase start` stack.
// The guard refuses anything that is not a loopback Supabase URL.
loadLocalCiEnv();

const BASE_URL = `http://127.0.0.1:${LOCAL_CI_APP_PORT}`;

export default defineConfig({
  testDir: "./qa/local-ci/tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "qa/report/local-ci-html", open: "never" }],
  ],
  globalSetup: "./qa/local-ci/global-setup.ts",
  outputDir: "qa/report/local-ci-results",
  use: {
    baseURL: BASE_URL,
    storageState: path.resolve("qa/.auth/local-ci/anon.json"),
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Only for machines whose preinstalled Chromium differs from the pinned
    // Playwright build; CI installs the matching browser instead.
    launchOptions: process.env.LOCAL_CI_CHROMIUM_PATH
      ? { executablePath: process.env.LOCAL_CI_CHROMIUM_PATH }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node qa/local-ci/serve-build.mjs --port ${LOCAL_CI_APP_PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
