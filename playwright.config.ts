import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { loadQaEnv } from "./qa/load-qa-env.mjs";
import { runPreflightChecks, validateUiDatabaseAlignment } from "./qa/env-guard.mjs";
import {
  assertPlaywrightWebServerConfigEnvSecretFree,
  buildPlaywrightWebServerConfigEnv,
} from "./qa/playwright-webserver-env.mjs";

loadQaEnv({ required: true });
runPreflightChecks(process.env);

const PORT = 8099;
const REMOTE_BASE_URL = process.env.E2E_FORCE_LOCAL === "1"
  ? undefined
  : process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
const BASE_URL = REMOTE_BASE_URL || `http://localhost:${PORT}`;
const ANON_STORAGE_STATE = path.resolve(process.cwd(), "qa/.auth/anon.json");

validateUiDatabaseAlignment({
  playwrightBaseUrl: BASE_URL,
  qaSupabaseUrl: process.env.QA_SUPABASE_URL,
  viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
  qaAppOrigin: process.env.FAMY_QA_APP_ORIGIN,
  productionAppOrigin: process.env.FAMY_PRODUCTION_APP_ORIGIN,
});

const webServerEnv = buildPlaywrightWebServerConfigEnv(process.env);
assertPlaywrightWebServerConfigEnvSecretFree(webServerEnv);

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
  globalTeardown: process.env.KEEP_QA_DATA ? undefined : "./qa/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    storageState: ANON_STORAGE_STATE,
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
        command: `node qa/playwright-dev-server.mjs --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: process.env.E2E_REUSE_DEV_SERVER === "1",
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
        env: webServerEnv,
      },
});
