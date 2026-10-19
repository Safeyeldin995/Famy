import { defineConfig, devices } from "@playwright/test";

const PORT = 8101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const useChromium = process.env.SPLASH_BROWSER !== "msedge";

export default defineConfig({
  testDir: "./qa/tests/splash",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: useChromium ? "chromium" : "msedge",
      use: useChromium
        ? { ...devices["Desktop Chrome"], channel: "chrome" }
        : {
            ...devices["Desktop Edge"],
            channel: "msedge",
          },
    },
  ],
  webServer: {
    command: `node qa/splash-dev-server.mjs --port ${PORT} --strictPort`,
    url: `${BASE_URL}/__splash/identity`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
