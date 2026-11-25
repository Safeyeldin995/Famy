/* Online lesson settings (#403) — node qa/provider-online-lessons-web.cjs <web-export-dir> <artifacts-dir> */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { waitForLaunchGateGone, screenshotWithoutLaunchOverlay } = require("./waitLaunchGate.cjs");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const config = require("../app.json").expo.extra;
const apiOrigin = new URL(config.supabaseUrl).origin;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(1);
const pid = id(2);
const tutoringServiceId = id(5);
const capId = id(11);
const now = new Date().toISOString();

const tutoringService = {
  id: tutoringServiceId,
  slug: "homework-support",
  name_ar: "مساعدة واجبات",
  name_en: "Homework support",
  pricing_model: "fixed",
  duration_min: 60,
  is_active: true,
  online_allowed: true,
  provider_pricing_allowed: false,
  minimum_price: 300,
  maximum_price: 1500,
  category: { slug: "tutoring", name_ar: "دروس", name_en: "Tutoring", online_allowed: true },
};

const providerRow = {
  id: pid,
  profile_id: uid,
  bio_ar: "مدرس تجربة",
  bio_en: "Test tutor",
  years_experience: 5,
  city: "القاهرة",
  onboarding_status: "APPROVED",
  is_verified: true,
  offering_mode: "both",
  profile: { full_name: "مدرس - اختبار", avatar_url: null, phone: "+201000000001" },
};

const providerServices = [
  {
    service_id: tutoringServiceId,
    price_override: null,
    online_price_override: 400,
    pending_online_price_override: null,
    status: "approved",
    service: tutoringService,
  },
];

const capabilities = [
  {
    id: capId,
    provider_id: pid,
    service_id: tutoringServiceId,
    session_duration_min: 60,
    session_price: 350,
    online_session_price: 320,
    status: "approved",
    subject: { code: "math", name_ar: "رياضيات", name_en: "Math" },
    curriculum: { code: "eg_national_ar", name_ar: "منهج مصري", name_en: "Egyptian" },
    level: { code: "g6", name_ar: "الصف السادس", name_en: "Grade 6" },
  },
];

const user = { id: uid, aud: "authenticated", role: "authenticated", created_at: now };
const payload = Buffer.from(
  JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 86400, role: "authenticated" }),
).toString("base64url");
const session = {
  access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${payload}.local-fixture-only`,
  refresh_token: "local-fixture-only",
  token_type: "bearer",
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  expires_in: 86400,
  user,
};

const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.resolve(exportDir, `.${pathname}`);
  if (!file.startsWith(exportDir + path.sep) && file !== exportDir) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(exportDir, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
  });
  await context.addInitScript(
    ({ key, session: fixtureSession }) => {
      localStorage.setItem("famy.lang", "ar");
      localStorage.setItem(key, JSON.stringify(fixtureSession));
    },
    { key: `sb-${new URL(apiOrigin).hostname.split(".")[0]}-auth-token`, session },
  );

  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== apiOrigin) return route.abort();
    const table = url.pathname.split("/").at(-1);
    const method = req.method();
    if (url.pathname.includes("/auth/")) {
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    }
    if (url.pathname.includes("/rpc/")) {
      if (table === "provider_update_offering_mode") return route.fulfill({ json: null });
      if (table === "provider_update_teaching_online_session_price") return route.fulfill({ json: null });
      if (table === "provider_request_online_price_change") return route.fulfill({ json: null });
      return route.fulfill({ json: null });
    }
  if (!["GET", "HEAD"].includes(method)) return route.fulfill({ json: {} });
    const tables = {
      profiles: [{ id: uid, full_name: "مدرس - اختبار" }],
      user_roles: [{ role: "provider" }],
      providers: [providerRow],
      provider_services: providerServices,
      services: [tutoringService],
      provider_teaching_capabilities: capabilities,
      teaching_subjects: [],
      teaching_curricula: [],
      teaching_levels: [],
      teaching_subject_services: [],
      service_teaching_levels: [],
      notifications: [],
    };
    let data = tables[table] || [];
    if (table === "providers" && url.searchParams.get("profile_id")?.startsWith("eq.")) {
      data = [providerRow];
    }
    const count = Array.isArray(data) ? data.length : 1;
    return route.fulfill({
      json: data,
      headers: { "content-range": `0-${Math.max(0, count - 1)}/${count}` },
    });
  });

  const ts = require("../../node_modules/typescript");
  const localeModule = { exports: {} };
  new Function(
    "exports",
    "module",
    ts.transpile(fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"), {
      module: ts.ModuleKind.CommonJS,
    }),
  )(localeModule.exports, localeModule);
  const ar = localeModule.exports.default;

  const page = await context.newPage();
  await page.goto(`${base}/pro-online-lessons`);
  await waitForLaunchGateGone(page);
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText(ar.pro.onlineLessons.title).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(ar.pro.onlineLessons.helpTitle).first()).toBeVisible();
  const file = path.join(artifacts, "online-lessons.png");
  await screenshotWithoutLaunchOverlay(page, file, "online-lessons");
  fs.writeFileSync(
    path.join(artifacts, "screenshots.json"),
    JSON.stringify([{ screen: "online-lessons", path: file, viewport: "390x844", language: "ar" }], null, 2),
  );
  console.log(`PASS: online-lessons fixture screenshot → ${file}`);
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});