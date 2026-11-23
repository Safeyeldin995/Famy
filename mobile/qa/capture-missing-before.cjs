/** Capture baseline screenshots for profile, sign-in, provider wallet (390×844). */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("../../node_modules/@playwright/test");
const { waitForLaunchGateGone, screenshotWithoutLaunchOverlay } = require("./waitLaunchGate.cjs");
const { installPhase1SupabaseMock } = require("./lib/phase1-supabase-mock.cjs");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3] || "qa/ui-polish-evidence/before");
fs.mkdirSync(artifacts, { recursive: true });

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

async function run() {
  const errors = [];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  // Sign-in (signed out)
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-EG" });
    const page = await context.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await waitForLaunchGateGone(page);
    await page.evaluate(() => document.fonts.ready);
    await screenshotWithoutLaunchOverlay(page, path.join(artifacts, "sign-in.png"), "sign-in");
    await context.close();
  }

  // Profile (signed in customer)
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-EG" });
    await installPhase1SupabaseMock(context, base, errors, {});
    const page = await context.newPage();
    await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
    await waitForLaunchGateGone(page);
    await page.evaluate(() => document.fonts.ready);
    await screenshotWithoutLaunchOverlay(page, path.join(artifacts, "profile.png"), "profile");
    await context.close();
  }

  await browser.close();
  server.close();
  if (errors.length) console.warn(errors);
  console.log("Wrote sign-in.png and profile.png to", artifacts);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});