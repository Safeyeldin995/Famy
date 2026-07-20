import { defineConfig, devices } from "@playwright/test";

const PORT = 8099;
const REMOTE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const BASE_URL = REMOTE_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./qa/tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "qa/report/results.json" }],
  ],
  globalSetup: "./qa/global-setup.ts",
  // KEEP_QA_DATA=1 skips automatic cleanup for interactive debugging; run
  // `npm run test:e2e:cleanup` afterward to remove the QA_ accounts/records.
  globalTeardown: process.env.KEEP_QA_DATA ? undefined : "./qa/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: REMOTE_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
