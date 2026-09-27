import { defineConfig, devices } from "@playwright/test";

const PORT = 8100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const useChromium = process.env.ISSUE68_BROWSER === "chromium";

export default defineConfig({
  testDir: "./qa/tests/issue68",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
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
    command: `node qa/issue68-dev-server.mjs --port ${PORT} --strictPort`,
    url: `${BASE_URL}/__issue68/identity`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
