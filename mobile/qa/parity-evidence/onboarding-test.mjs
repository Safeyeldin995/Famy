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
  await expect(page.getByTestId("launch-overlay")).toBeVisible();
  await page.waitForTimeout(2200);
  await fs.mkdir(path.join(out, "native/onboarding"), { recursive: true });
  await page.screenshot({ path: path.join(out, "native/onboarding/splash-assembled.png") });
  await expect(page.getByTestId("launch-overlay")).toHaveCount(0, { timeout: 12000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem("famy.splash.played")), "1");
  await fs.mkdir(path.join(out, "native/onboarding"), { recursive: true });
  for (let step = 1; step <= 3; step++) {
    const dots = await page.locator('[data-testid^="onboarding-dot-"]').evaluateAll((elements) =>
      elements.map((element) => ({
        x: element.getBoundingClientRect().x,
        width: element.getBoundingClientRect().width,
      })),
    );
    assert(dots[0].x > dots[1].x && dots[1].x > dots[2].x, "Arabic dots run right to left");
    assert.equal(dots[step - 1].width, 32);
    await page.screenshot({ path: path.join(out, `native/onboarding/slide-${step}.png`) });
    await page
      .getByRole("button", { name: step === 3 ? "ابدأ الآن" : "متابعة", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/login/);
  const en = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB" });
  await en.addInitScript(() => localStorage.setItem("famy.lang", "en"));
  await en.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const enPage = await en.newPage();
  await enPage.goto(base);
  await expect(enPage.getByTestId("launch-overlay")).toHaveCount(0, { timeout: 12000 });
  for (let step = 0; step < 3; step++) {
    await expect(enPage.getByTestId(`onboarding-dot-${step}`)).toBeVisible();
    const dots = await enPage.locator('[data-testid^="onboarding-dot-"]').evaluateAll((elements) =>
      elements.map((element) => ({
        x: element.getBoundingClientRect().x,
        width: element.getBoundingClientRect().width,
      })),
    );
    assert(dots[0].x < dots[1].x && dots[1].x < dots[2].x, "English dots run left to right");
    assert.equal(dots[step].width, 32);
    await enPage.screenshot({ path: path.join(out, `native/onboarding/slide-en-${step + 1}.png`) });
    if (step < 2) await enPage.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await en.close();
  for (const failSafe of [false, true]) {
    const motion = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: failSafe ? "no-preference" : "reduce",
    });
    await motion.addInitScript(
      ({ failSafe }) => {
        localStorage.setItem("famy.lang", "ar");
        if (failSafe) window.requestAnimationFrame = () => 1;
      },
      { failSafe },
    );
    await motion.route("**/*", (route) =>
      new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
    );
    const testPage = await motion.newPage();
    await testPage.goto(base);
    await expect(testPage.getByText("محترفون موثوقون", { exact: true })).toBeVisible();
    if (failSafe) await expect(testPage.getByTestId("launch-overlay")).toBeVisible();
    await expect(testPage.getByTestId("launch-overlay")).toHaveCount(0, { timeout: 12000 });
    assert.equal(await testPage.evaluate(() => sessionStorage.getItem("famy.splash.played")), "1");
    await motion.close();
  }
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
