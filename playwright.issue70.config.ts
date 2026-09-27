import { defineConfig, devices } from "@playwright/test";

const PORT = 8200;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const useChromium = process.env.ISSUE70_BROWSER !== "msedge";

export default defineConfig({
  testDir: "./qa/tests/issue70",
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
  projects: useChromium
    ? [
        {
          name: "chromium-desktop",
          use: { ...devices["Desktop Chrome"], channel: "chrome" },
        },
        {
          name: "chromium-mobile",
          use: { ...devices["Pixel 5"], channel: "chrome" },
        },
      ]
    : [
        {
          name: "msedge-desktop",
          use: { ...devices["Desktop Edge"], channel: "msedge" },
        },
        {
          name: "msedge-mobile",
          use: { ...devices["Pixel 5"], channel: "msedge" },
        },
      ],
  webServer: {
    command: `node qa/issue70-dev-server.mjs --port ${PORT} --strictPort`,
    url: `${BASE_URL}/__issue70/identity`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
