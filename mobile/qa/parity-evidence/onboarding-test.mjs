import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium, expect } = require("../../../node_modules/@playwright/test");
const ts = require("../../../node_modules/typescript");
const out = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(out, "../..");
// Exercise real persistence implementation with a storage adapter, including unavailable storage.
const source = await fs.readFile(path.join(mobile, "src/lib/onboarding.ts"), "utf8");
function load(storage) {
  const module = { exports: {} };
  new Function(
    "require",
    "exports",
    "module",
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  )(() => ({ default: storage }), module.exports, module);
  return module.exports;
}
let saved = null;
const storage = {
  getItem: async () => saved,
  setItem: async (key, value) => {
    assert.equal(key, "onboarded");
    saved = value;
  },
};
const first = load(storage);
assert.equal(await first.isOnboarded(), false);
await first.completeOnboarding();
assert.equal(saved, "true");
assert.equal(await load(storage).isOnboarded(), true);
const broken = load({
  getItem: async () => {
    throw Error("offline storage");
  },
  setItem: async () => {
    throw Error("offline storage");
  },
});
assert.equal(await broken.isOnboarded(), false);
await broken.completeOnboarding();
assert.equal(await broken.isOnboarded(), true);
const exportDir = path.join(mobile, "dist-parity");
const server = http.createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(exportDir, `.${relative}`);
    if (!file.startsWith(exportDir + path.sep)) file = path.join(exportDir, "index.html");
    try {
      if (!(await fs.stat(file)).isFile()) file = path.join(exportDir, "index.html");
    } catch {
      file = path.join(exportDir, "index.html");
    }
    const mime = {
      ".js": "application/javascript",
      ".html": "text/html",
      ".ttf": "font/ttf",
      ".png": "image/png",
      ".css": "text/css",
    };
    res.setHeader("content-type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
  });
  await context.addInitScript(() => localStorage.setItem("famy.lang", "ar"));
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(base);
  await expect(page.getByText("محترفون موثوقون", { exact: true })).toBeVisible();
  await page.waitForTimeout(1800);
  await fs.mkdir(path.join(out, "native/onboarding"), { recursive: true });
  for (let step = 1; step <= 3; step++) {
    await page.screenshot({ path: path.join(out, `native/onboarding/slide-${step}.png`) });
    await page
      .getByRole("button", { name: step === 3 ? "ابدأ الآن" : "متابعة", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/login/);
  assert.equal(await page.evaluate(() => localStorage.getItem("onboarded")), "true");
  await page.goto(base);
  await expect(page).toHaveURL(/\/login/);
  await page.evaluate(() => localStorage.removeItem("onboarded"));
  await page.goto(base);
  await expect(page.getByRole("button", { name: "تخطي", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "تخطي", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  console.log(
    "PASS: persistence, storage failure, three slides, completion, reload, Skip; network isolated.",
  );
} finally {
  await browser.close();
  server.close();
}
