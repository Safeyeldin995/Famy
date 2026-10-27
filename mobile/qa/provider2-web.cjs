/* Provider part 2 fixtures — node qa/provider2-web.cjs <web-export-dir> <artifacts-dir> */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { waitForLaunchGateGone, screenshotWithoutLaunchOverlay } = require("./waitLaunchGate.cjs");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const config = require("../app.json").expo.extra;
const apiOrigin = new URL(config.supabaseUrl).origin;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(1);
const pid = id(2);
const sid = id(5);
const zoneId = id(7);
const now = new Date().toISOString();
const service = {
  id: sid,
  slug: "babysitting-hourly",
  name_ar: "رعاية بالساعة",
  name_en: "Hourly care",
  pricing_model: "hourly",
  duration_min: 60,
  is_active: true,
  provider_pricing_allowed: true,
  minimum_price: 100,
  maximum_price: 300,
  category: { slug: "babysitting", name_ar: "رعاية", name_en: "Care" },
};
const providerDraft = {
  id: pid,
  profile_id: uid,
  bio_ar: "",
  bio_en: "",
  years_experience: 0,
  city: null,
  onboarding_status: "DRAFT",
  profile: { full_name: "مقدمة - اختبار", avatar_url: null, phone: "+201000000001" },
};
const providerApproved = {
  ...providerDraft,
  onboarding_status: "APPROVED",
  is_verified: true,
  bio_ar: "اختبار",
  city: "منطقة اختبار",
};
let providerRow = { ...providerDraft };
const zones = [{ id: zoneId, name_ar: "منطقة اختبار", name_en: "Test zone", is_active: true }];
const providerServices = [];
const documents = [];
const notificationPrefs = {
  user_id: uid,
  booking_push: true,
  chat_push: true,
  reminder_push: true,
  support_push: true,
  campaign_push: false,
  campaign_in_app: true,
};
const snapshot = {
  profile: { full_name: "مقدمة - اختبار", avatar_url: null },
  provider: { bio_ar: "", bio_en: "", years_experience: 0, languages: ["ar"] },
  details: {},
};
const writes = [];
const errors = [];
const screenshots = [];
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
    ({ key, session }) => {
      localStorage.setItem("famy.lang", "ar");
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: `sb-${new URL(apiOrigin).hostname.split(".")[0]}-auth-token`, session },
  );
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.origin !== apiOrigin) {
      errors.push(`Unexpected external request: ${url.pathname}`);
      return route.abort();
    }
    const table = url.pathname.split("/").at(-1);
    const method = req.method();
    let body = {};
    try {
      body = req.postDataJSON() ?? {};
    } catch {
      body = {};
    }
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    if (url.pathname.includes("/storage/")) {
      writes.push({ table: "storage", method, body: { path: url.pathname } });
      return route.fulfill({ json: { Key: "fixture" } });
    }
    if (!["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/")) {
      writes.push({ table, method, body });
      if (table === "notification_preferences") Object.assign(notificationPrefs, body);
      if (table === "provider_services" && method === "PATCH") {
        const row = providerServices.find((r) => r.service_id === body?.service_id);
        if (row) row.price_override = body.price_override;
      }
      return route.fulfill({ json: body });
    }
    let data;
    if (url.pathname.includes("/rpc/")) {
      writes.push({ table, method, body });
      if (table === "provider_onboarding_snapshot") data = snapshot;
      else if (table === "provider_save_onboarding_section") data = { ok: true };
      else if (table === "provider_submit_onboarding") {
        providerRow.onboarding_status = "SUBMITTED";
        data = { ok: true };
      } else if (table === "provider_start_onboarding") {
        providerRow = { ...providerDraft };
        data = null;
      } else if (table === "provider_prepare_document_upload") {
        if (body.p_size_bytes > 10 * 1024 * 1024) {
          return route.fulfill({ status: 400, json: { message: "file_too_large" } });
        }
        data = { path: `${pid}/${body.p_type}-fixture.jpg` };
      } else if (table === "provider_finalize_document_upload") {
        documents.push({ id: id(50 + documents.length), type: body.p_type, status: "pending" });
        data = id(99);
      } else if (table === "replace_provider_availability") data = null;
      else if (table === "provider_remove_onboarding_service") data = null;
      else data = null;
    } else {
      const tables = {
        profiles: [{ id: uid, full_name: "مقدمة - اختبار" }],
        user_roles: [{ role: "provider" }],
        providers: [providerRow],
        services: [service],
        zones,
        zone_providers: providerServices.length ? [{ zone_id: zoneId, provider_id: pid }] : [],
        provider_services: providerServices,
        provider_documents: documents,
        provider_references: [],
        provider_onboarding_details: [],
        child_age_groups: [],
        availability_rules: [],
        provider_vacations: [],
        availability_exceptions: [],
        notification_preferences: [notificationPrefs],
        provider_teaching_capabilities: [],
        teaching_subjects: [],
        teaching_curricula: [],
        teaching_levels: [],
        teaching_subject_services: [],
      };
      if (!(table in tables)) errors.push(`Unhandled table: ${table}`);
      data = tables[table] || [];
      if (table === "providers" && url.searchParams.get("profile_id")?.startsWith("eq."))
        data = [providerRow];
    }
    const count = Array.isArray(data) ? data.length : data ? 1 : 0;
    if (req.headers().accept?.includes("vnd.pgrst.object"))
      data = Array.isArray(data) ? data[0] || null : data;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(0, count - 1)}/${count}`,
      },
      body: method === "HEAD" ? "" : JSON.stringify(data),
    });
  });

  const ts = require("../../node_modules/typescript");
  const localeModule = { exports: {} };
  new Function(
    "exports",
    "module",
    ts.transpile(
      fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"),
      {
        module: ts.ModuleKind.CommonJS,
      },
    ),
  )(localeModule.exports, localeModule);
  const ar = localeModule.exports.default;

  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  async function visit(route) {
    await page.goto(base + route);
    await waitForLaunchGateGone(page);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    const file = path.join(artifacts, `${name}.png`);
    await screenshotWithoutLaunchOverlay(page, file, name);
    screenshots.push({ screen: name, path: file, viewport: "390x844", language: "ar" });
  }

  providerRow = { ...providerDraft };
  await visit("/pro-apply");
  await expect(page.getByText(ar.providerApply.welcome).first()).toBeVisible({ timeout: 20000 });
  await shot("apply-step-1");

  await page.getByLabel(ar.providerApply.name).fill("مقدمة اختبار");
  await page.getByText("منطقة اختبار", { exact: true }).click();
  await page.getByRole("button", { name: ar.providerApply.continue, exact: true }).click();
  await shot("apply-step-2");

  await page.getByText("رعاية بالساعة", { exact: true }).click();
  assert(writes.some((w) => w.table === "provider_save_onboarding_section"));
  await page.getByRole("button", { name: ar.providerApply.continue, exact: true }).click();
  await shot("apply-step-3");

  providerRow = { ...providerApproved };
  await visit("/pro-profile-edit");
  await expect(page.getByText(ar.pro.profile.title).first()).toBeVisible();
  await shot("profile-edit");

  await visit("/pro-notification-preferences");
  await expect(page.getByText(ar.mobilePro.notificationPrefs).first()).toBeVisible();
  await page.getByRole("switch", { name: ar.notifPrefs.bookingUpdates }).click();
  await expect.poll(() => writes.some((w) => w.table === "notification_preferences")).toBe(true);
  await shot("notification-prefs");

  await visit("/pro-documents");
  await expect(page.getByText(ar.providerDocuments.title).first()).toBeVisible();
  await shot("documents");

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, "screenshots.json"), JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify({ passed: true, screenshots: screenshots.length, writes }, null, 2),
  );
  console.log(`PASS: ${screenshots.length} Arabic provider part 2 screenshots`);
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
