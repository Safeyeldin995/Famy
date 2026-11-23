/**
 * Measures customer home diagnostics counters on the Expo web export.
 * Usage (from mobile/): node qa/home-freeze-diag.mjs <export-dir> [legacy 0|1]
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("../../node_modules/@playwright/test");
const { waitForLaunchGateGone } = require("./waitLaunchGate.cjs");
const { installPhase1SupabaseMock } = require("./lib/phase1-supabase-mock.cjs");

const exportDir = path.resolve(process.argv[2] || "dist-investor-demo");
const legacy = process.argv[3] === "1";

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.resolve(exportDir, `.${pathname}`);
  if (!file.startsWith(exportDir + path.sep) && file !== exportDir) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(exportDir, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

async function readDiag(page) {
  return page.evaluate(() => globalThis.__FAMY_HOME_DIAG__ ?? null);
}

async function run() {
  const errors = [];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-EG" });
  await installPhase1SupabaseMock(context, base, errors, {
    homeFreezeDiag: true,
    homeFreezeLegacy: legacy,
  });

  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  const tabs = { home: "الرئيسية", bookings: "الحجوزات", profile: "حسابي" };
  const openTab = async (key) => {
    await page.getByRole("tab", { name: tabs[key], exact: true }).click();
    await page.waitForTimeout(600);
  };

  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await waitForLaunchGateGone(page);
  await page.getByTestId("home-unread").waitFor({ timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(30_000);
  const mid = await readDiag(page);

  for (let i = 0; i < 2; i++) {
    await openTab("bookings");
    await openTab("profile");
    await openTab("home");
  }
  const end = await readDiag(page);

  await browser.close();
  server.close();

  if (errors.length) console.warn("home-freeze-diag warnings:", errors.slice(0, 5));

  const out = {
    legacy,
    after30sOnHome: mid,
    afterTwoTabCycles: end,
    capturedAt: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, `home-freeze-diag${legacy ? "-legacy" : "-current"}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});