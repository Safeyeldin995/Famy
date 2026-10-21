/* Local-only provider UI fixtures. Run: node qa/provider-web.cjs <export-dir> <artifacts-dir> */
const { chromium, expect } = require("../../node_modules/@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");

const exportDir = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const config = require("../app.json").expo.extra;
const apiOrigin = new URL(config.supabaseUrl).origin;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const uid = id(1);
const pid = id(2);
const bidPending = id(3);
const bidActive = id(4);
const sid = id(5);
const now = new Date().toISOString();
const service = {
  id: sid,
  slug: "babysitting-hourly",
  name_ar: "رعاية بالساعة",
  name_en: "Hourly care",
  pricing_model: "hourly",
  duration_min: 60,
  is_active: true,
};
const providerRow = {
  id: pid,
  profile_id: uid,
  bio_ar: "اختبار",
  bio_en: "Test",
  years_experience: 3,
  hourly_rate: 150,
  city: "منطقة اختبار",
  country: "EG",
  languages: ["ar"],
  is_active: true,
  is_verified: true,
  is_top_pro: false,
  vacation_mode: false,
  onboarding_status: "APPROVED",
  buffer_minutes: 30,
  min_notice_hours: 4,
  max_advance_days: 60,
  profile: { full_name: "مقدمة خدمة - اختبار", avatar_url: null, phone: "+201000000001" },
  ratings: [{ rating_avg: 4.9, rating_count: 2 }],
};
const providerPending = {
  ...providerRow,
  id: id(20),
  onboarding_status: "UNDER_REVIEW",
  is_verified: false,
};
const bookingPending = {
  id: bidPending,
  provider_id: pid,
  customer_id: id(6),
  service_id: sid,
  status: "pending",
  start_at: new Date(Date.now() + 2 * 3600000).toISOString(),
  end_at: new Date(Date.now() + 3 * 3600000).toISOString(),
  price_subtotal: 150,
  price_extras_total: 0,
  price_travel_fee: 0,
  price_total: 150,
  currency: "EGP",
  created_at: now,
  service,
  location: [],
  customer: { full_name: "عميل - اختبار", avatar_url: null, phone: null },
};
const bookingConfirmed = {
  ...bookingPending,
  id: bidActive,
  status: "confirmed",
  customer: { full_name: "عميل - اختبار", avatar_url: null, phone: "+201000000002" },
};
const availability = [0, 1, 2, 3, 4].map((weekday) => ({
  id: id(10 + weekday),
  provider_id: pid,
  weekday,
  start_time: "09:00:00",
  end_time: "17:00:00",
}));
let providerMode = "approved";
const writes = [];
const errors = [];
const screenshots = [];
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  created_at: now,
  app_metadata: {},
  user_metadata: {},
};
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
    const body = req.postDataJSON();
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    if (!["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/")) {
      writes.push({ table, method, body });
      if (table === "bookings" && body?.status) {
        bookingPending.status = body.status;
        bookingConfirmed.status = body.status;
      }
      return route.fulfill({ json: body });
    }
    let data;
    if (url.pathname.includes("/rpc/")) {
      if (table === "booking_party_profiles") {
        data = (body.p_booking_ids || []).map((booking_id) => ({
          booking_id,
          other_name: "عميل - اختبار",
          other_avatar_url: null,
          other_phone: booking_id === bidPending ? null : "+201000000002",
          area: "منطقة اختبار",
          zone_name_ar: "منطقة اختبار",
          zone_name_en: "Test area",
        }));
      } else if (table === "replace_provider_availability") {
        writes.push({ table, method, body });
        return route.fulfill({ json: null });
      } else if (table === "cancel_booking") {
        writes.push({ table, method, body });
        bookingPending.status = "cancelled";
        return route.fulfill({ json: { ok: true } });
      } else {
        errors.push(`Unhandled RPC: ${table}`);
        data = [];
      }
    } else {
      const providers =
        providerMode === "approved" ? [providerRow] : providerMode === "pending" ? [providerPending] : [];
      const tables = {
        profiles: [{ id: uid, full_name: "مقدمة خدمة - اختبار" }],
        user_roles: [{ role: "provider" }],
        providers,
        bookings: [bookingPending, bookingConfirmed],
        availability_rules: availability,
        notifications: [
          {
            id: id(30),
            user_id: uid,
            title_ar: "طلب جديد",
            body_ar: "اختبار",
            title_en: "New request",
            created_at: now,
            read_at: null,
            deep_link: `/pro/booking/${bidPending}`,
          },
        ],
        payments: [
          {
            id: id(31),
            booking_id: bidActive,
            status: "pending",
            amount: 150,
            payment_method_type: "cash",
            payment_method_name_ar: "نقدا",
            payment_method_name_en: "Cash",
            created_at: now,
          },
        ],
        provider_services: [
          {
            service_id: sid,
            price_override: null,
            status: "approved",
            service,
          },
        ],
        cancellation_reasons: [
          {
            id: id(32),
            code: "test",
            name_ar: "سبب اختبار",
            name_en: "Test reason",
            actor_type: "provider",
            requires_note: false,
            is_active: true,
            display_order: 1,
          },
        ],
      };
      if (!(table in tables)) errors.push(`Unhandled table: ${table}`);
      data = tables[table] || [];
      const filterId = url.searchParams.get("id");
      if (filterId?.startsWith("eq.")) data = data.filter((row) => row.id === filterId.slice(3));
      if (table === "providers" && url.searchParams.get("profile_id")?.startsWith("eq.")) {
        data = providers;
      }
      if (table === "bookings" && url.searchParams.get("provider_id")?.startsWith("eq.")) {
        data = [bookingPending, bookingConfirmed];
      }
      if (url.searchParams.get("limit")) data = data.slice(0, Number(url.searchParams.get("limit")));
    }
    const count = Array.isArray(data) ? data.length : data ? 1 : 0;
    if (req.headers().accept?.includes("vnd.pgrst.object")) data = Array.isArray(data) ? data[0] || null : data;
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
    ts.transpile(fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"), {
      module: ts.ModuleKind.CommonJS,
    }),
  )(localeModule.exports, localeModule);
  const ar = localeModule.exports.default;

  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  async function visit(route) {
    await page.goto(base + route);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    const file = path.join(artifacts, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    screenshots.push({ screen: name, path: file, viewport: "390x844", language: "ar" });
  }

  providerMode = "approved";
  await visit("/dashboard");
  await expect(page.getByText("مقدمة", { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await shot("pro-dashboard");

  await visit("/jobs");
  await expect(page.getByText(ar.pro.bookings.title).first()).toBeVisible();
  await shot("pro-jobs");

  await visit("/schedule");
  await expect(page.getByText(ar.pro.schedule.title).first()).toBeVisible();
  await shot("pro-schedule");

  await visit("/earnings");
  await expect(page.getByText(ar.pro.earnings.title).first()).toBeVisible();
  await shot("pro-earnings");

  await visit("/pro-profile");
  await expect(page.getByText(ar.pro.nav.profile).first()).toBeVisible();
  await shot("pro-profile");

  await visit("/pro-notifications");
  await shot("pro-notifications");

  await visit(`/pro-booking/${bidPending}`);
  await page.getByRole("button", { name: ar.pro.booking.decline, exact: true }).click();
  await page.getByText("سبب اختبار", { exact: true }).click();
  await page.getByRole("button", { name: ar.pro.booking.confirm, exact: true }).click();
  assert(writes.some((w) => w.table === "cancel_booking"));
  await shot("pro-booking-decline");

  bookingPending.status = "pending";
  await visit(`/pro-booking/${bidPending}`);
  await page.getByRole("button", { name: ar.pro.booking.accept, exact: true }).click();
  assert(writes.some((w) => w.table === "bookings" && w.body?.status === "confirmed"));
  await shot("pro-booking-accept");

  await visit(`/pro-booking/${bidActive}`);
  await page.getByRole("button", { name: ar.pro.booking.onTheWay, exact: true }).click();
  assert(writes.some((w) => w.body?.status === "on_the_way"));
  await shot("pro-booking-start");

  await visit("/schedule");
  await page.getByRole("button", { name: ar.pro.schedule.saveSchedule, exact: true }).click();
  assert(writes.some((w) => w.table === "replace_provider_availability"));
  await shot("pro-schedule-save");

  providerMode = "pending";
  await visit("/dashboard");
  await page.waitForTimeout(1200);
  await shot("pro-not-approved");

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, "screenshots.json"), JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify({ passed: true, screenshots: screenshots.length, writes }, null, 2),
  );
  console.log(`PASS: ${screenshots.length} Arabic provider screenshots`);
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
