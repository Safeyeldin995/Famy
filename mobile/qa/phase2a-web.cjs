/* Local-only UI fixtures. Nothing here ships in the app or contacts Supabase.
 * Run from mobile: node qa/phase1-web.cjs <export-directory> <artifact-directory>
 */
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
const uid = id(1),
  pid = id(2),
  bid = id(3),
  sid = id(4),
  aid = id(5),
  mid = id(6);
const categories = [
  {
    id: id(7),
    slug: "babysitting",
    name_ar: "رعاية الأطفال",
    name_en: "Babysitting",
    is_active: true,
    sort_order: 1,
  },
  {
    id: id(8),
    slug: "tutoring",
    name_ar: "الدروس الخصوصية",
    name_en: "Tutoring",
    is_active: true,
    sort_order: 2,
  },
];
const service = {
  id: sid,
  slug: "babysitting-hourly",
  name_ar: "رعاية بالساعة",
  name_en: "Hourly care",
  pricing_model: "hourly",
  duration_min: 60,
  is_active: true,
  category: categories[0],
};
const provider = {
  id: pid,
  full_name: "مقدمة خدمة - اختبار محلي",
  avatar_url: null,
  bio_ar: "بيانات اختبار محلية للتحقق من عرض الشاشة فقط.",
  bio_en: "Local UI test fixture only.",
  hourly_rate: 150,
  years_experience: 3,
  languages: ["ar"],
  city: "منطقة اختبار",
  is_top_pro: false,
  is_verified: true,
  rating_avg: 4.8,
  rating_count: 2,
  trust_score: 80,
  service_id: sid,
  service_slug: service.slug,
  service_name_ar: service.name_ar,
  service_name_en: service.name_en,
  category_slug: "babysitting",
};
let scenario = "hourly";
let paymentRows = [];
let reviewRows = [];
let creates = [];
let paymobCalls = 0;
let receiptUploads = 0;
let signedProofCalls = 0;
const methodRows = ["cash", "manual_transfer", "online"].map((method_type, n) => ({
  id: id(40 + n),
  code: method_type === "manual_transfer" ? "instapay" : method_type,
  name_ar: ["كاش", "تحويل إنستاباي", "دفع أونلاين"][n],
  name_en: method_type,
  method_type,
  is_default: n === 0,
  is_active: true,
}));
const capability = {
  id: id(50),
  provider_id: pid,
  service_id: sid,
  curriculum_id: id(51),
  level_id: id(52),
  session_duration_min: 90,
  session_price: 300,
  status: "approved",
  subject: {
    code: "math",
    name_ar: "رياضيات اختبار",
    name_en: "Math",
    max_session_duration_min: 120,
  },
  curriculum: { code: "national", name_ar: "منهج اختبار", name_en: "Curriculum" },
  level: { code: "g3", name_ar: "صف اختبار", name_en: "Grade" },
};
const now = new Date().toISOString();
const booking = {
  id: bid,
  provider_id: pid,
  customer_id: uid,
  service_id: sid,
  status: "confirmed",
  start_at: now,
  end_at: new Date(Date.now() + 3600000).toISOString(),
  price_subtotal: 150,
  price_extras_total: 0,
  price_travel_fee: 0,
  price_platform_fee: 0,
  price_vat: 0,
  price_discount: 0,
  price_total: 150,
  currency: "EGP",
  service,
  location: [],
};
const member = {
  id: mid,
  customer_id: uid,
  full_name: "فرد أسرة - اختبار محلي",
  relationship: "son",
  relationship_other: null,
  date_of_birth: "2018-01-02",
  gender: "male",
  phone: null,
  allergies: null,
  medical_notes: null,
  access_notes: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  education_curriculum_id: null,
  education_level_id: null,
  is_active: true,
  created_at: now,
};
let addresses = [
  {
    id: aid,
    user_id: uid,
    area: "منطقة اختبار محلية",
    label: "home",
    street: "شارع اختبار",
    building: "1",
    is_default: true,
    created_at: now,
  },
  {
    id: id(9),
    user_id: uid,
    area: "منطقة اختبار ثانية",
    label: "family",
    is_default: false,
    created_at: now,
  },
];
addresses = addresses.map((a) => ({ ...a, lat: 30.03, lng: 31.0 }));
let members = [member];
let favorites = [];
let notifications = [
  {
    id: id(10),
    user_id: uid,
    title_ar: "تحديث حجز - اختبار محلي",
    body_ar: "إشعار اختبار لعرض الحالة المقروءة.",
    title_en: "Local test booking update",
    created_at: now,
    read_at: null,
    deep_link: `/booking/${bid}`,
  },
];
const writes = [];
let mode = "populated";
let failures = 0;
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
const screenshots = [];
const errors = [];
let browser;

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
    permissions: ["clipboard-read", "clipboard-write", "geolocation"],
    geolocation: { latitude: 30.03, longitude: 31.0 },
    timezoneId: "Africa/Cairo",
  });
  await context.addInitScript(
    ({ key, session }) => {
      localStorage.setItem("famy.lang", "ar");
      localStorage.setItem(key, JSON.stringify(session));
    },
    { key: `sb-${new URL(apiOrigin).hostname.split(".")[0]}-auth-token`, session },
  );
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.pathname === "/api/mobile/paymob-checkout") {
      assert.equal(req.headers().authorization, `Bearer ${session.access_token}`);
      assert.deepEqual(req.postDataJSON(), { bookingId: bid, paymentId: id(13) });
      paymobCalls++;
      return route.fulfill({
        json: { ok: true, paymentId: id(13), checkoutUrl: "https://checkout.local.test/pay" },
      });
    }
    if (url.origin === "https://checkout.local.test")
      return route.fulfill({
        contentType: "text/html",
        body: "<p>Local hosted checkout fixture</p>",
      });
    if (
      url.origin === apiOrigin &&
      url.pathname.includes("/storage/v1/object/sign/payment-proofs/")
    ) {
      if (req.method() === "POST") {
        assert.equal(req.postDataJSON().expiresIn, 600);
        signedProofCalls++;
        return route.fulfill({
          json: { signedURL: "/object/sign/payment-proofs/local?token=local-fixture" },
        });
      }
      return route.fulfill({ contentType: "text/html", body: "Local receipt fixture" });
    }
    if (url.origin === apiOrigin && url.pathname.includes("/storage/v1/object/payment-proofs/")) {
      assert(url.pathname.includes(`${bid}/proof-`));
      assert.equal(req.method(), "POST");
      receiptUploads++;
      return route.fulfill({ json: { Key: "local" } });
    }
    if (url.origin !== apiOrigin) {
      errors.push(`Unexpected external request: ${url.pathname}`);
      return route.abort();
    }
    const table = url.pathname.split("/").at(-1);
    const method = req.method();
    const body = req.postDataJSON();
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    if (mode === "error" && method === "GET" && table === "addresses") {
      failures++;
      return route.fulfill({ status: 503, json: { message: "Isolated test failure" } });
    }
    if (!["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/")) {
      writes.push({ table, method, body, search: url.search });
      if (table === "payments") {
        if (method === "POST") {
          assert.equal(body.amount, booking.price_total);
          assert.equal(body.customer_id, uid);
          assert(!("method" in body));
          const m = methodRows.find((m) => m.id === body.payment_method_id);
          paymentRows = [
            {
              ...body,
              id: id(13),
              payment_method_type: m.method_type,
              payment_method_name_ar: m.name_ar,
              payment_method_snapshot: {
                instructions_ar: "تعليمات تحويل اختبار",
                public_config: { handle: "local-fixture@instapay", note: "ملاحظة اختبار" },
              },
              created_at: now,
            },
          ];
        } else {
          assert.deepEqual(Object.keys(body).sort(), ["proof_path", "proof_uploaded_at"]);
          Object.assign(paymentRows[0], body);
        }
        return route.fulfill({ json: paymentRows[0] });
      }
      if (table === "reviews") {
        assert.equal(booking.status, "completed");
        assert.equal(body.customer_id, uid);
        reviewRows = [{ id: id(60), ...body }];
        return route.fulfill({ json: reviewRows[0] });
      }
      if (table === "addresses" && method === "POST") {
        assert.equal(body.lat, 30.03);
        assert.equal(body.lng, 31);
        addresses.push({ id: id(70), ...body });
        return route.fulfill({ json: addresses.at(-1) });
      }

      if (table === "favorites") favorites = method === "DELETE" ? [] : [{ provider_id: pid }];
      if (table === "notifications")
        notifications = notifications.map((n) => ({ ...n, read_at: now }));
      if (table === "addresses") {
        const target = url.searchParams.get("id")?.slice(3);
        addresses =
          method === "DELETE"
            ? addresses.filter((a) => a.id !== target)
            : addresses.map((a) => ({ ...a, is_default: a.id === target }));
      }
      if (table === "family_members") {
        if (method === "POST") members.push({ ...member, ...body, id: id(30) });
        else
          members = members.map((m) =>
            m.id === url.searchParams.get("id")?.slice(3) ? { ...m, ...body } : m,
          );
      }
      const result =
        table === "family_members"
          ? members.find((m) => m.id === url.searchParams.get("id")?.slice(3)) || members.at(-1)
          : null;
      return route.fulfill({ json: result });
    }
    let data;
    if (url.pathname.includes("/rpc/")) {
      if (table === "marketplace_provider_booking_settings")
        data = [
          { vacation_mode: false, min_notice_hours: 0, max_advance_days: 12, buffer_minutes: 0 },
        ];
      else if (table === "resolve_zone") data = [{ id: id(80), travel_fee: 10 }];
      else if (table === "create_booking") {
        assert.equal(body.p_provider_id, pid);
        assert.equal(body.p_service_id, sid);
        assert.equal(body.p_address_id, aid);
        assert.equal(body.p_family_member_id, mid);
        assert(body.p_idempotency_key);
        assert(!("price_total" in body));
        assert.equal(body.p_requirement_selections[0].chosen_by, "provider");
        const duration = (new Date(body.p_end_at) - new Date(body.p_start_at)) / 60000;
        assert.equal(duration, scenario === "tutoring" ? 90 : scenario === "package" ? 480 : 240);
        if (scenario === "tutoring") assert.equal(body.p_teaching_capability_id, capability.id);
        creates.push(body);
        Object.assign(booking, {
          start_at: body.p_start_at,
          end_at: body.p_end_at,
          status: "pending",
          price_subtotal: scenario === "tutoring" ? 300 : scenario === "package" ? 800 : 400,
          price_vat: scenario === "tutoring" ? 42 : scenario === "package" ? 112 : 56,
          price_extras_total: 20,
          price_travel_fee: 10,
          price_platform_fee: 25,
          price_discount: 10,
          price_total: scenario === "tutoring" ? 387 : scenario === "package" ? 957 : 501,
        });
        return route.fulfill({
          json: { booking_id: bid, created: true, idempotent_replay: false },
        });
      } else if (table === "cancel_booking") {
        assert.equal(body.p_booking_id, bid);
        assert.equal(body.p_reason_id, id(61));
        assert.equal(body.p_note, "Local note");
        booking.status = "cancelled";
        writes.push({ table, method, body });
        return route.fulfill({ json: { ok: true } });
      } else if (table === "validate_promo_code")
        return route.fulfill({ json: { ok: true, discount_amount: 10, promo_code_id: id(62) } });
      else if (table === "search_marketplace_providers") data = mode === "empty" ? [] : [provider];
      else if (table === "marketplace_provider_details") data = mode === "empty" ? [] : [provider];
      else if (table === "marketplace_provider_bookable_services")
        data = [{ service_id: sid, effective_price: 150 }];
      else if (table === "get_active_featured_promo_codes")
        data =
          mode === "empty"
            ? []
            : [
                {
                  id: id(11),
                  code: "LOCALTEST",
                  description_ar: "كود اختبار محلي فقط",
                  description_en: "Local test only",
                  discount_type: "percentage",
                  discount_value: 10,
                  minimum_booking_amount: 100,
                  expires_at: null,
                },
              ];
      else if (table === "booking_party_profiles")
        data = (body.p_booking_ids || []).map((booking_id) => ({
          booking_id,
          other_name: provider.full_name,
          other_avatar_url: null,
          viewer_role: "customer",
        }));
      else {
        errors.push(`Unhandled RPC: ${table}`);
        data = [];
      }
    } else {
      const tables = {
        conversations: [], // No conversation in these customer fixtures; chat has its own harness.
        payment_methods: methodRows,
        availability_rules: [{ start_time: "08:00:00", end_time: "22:00:00" }],
        provider_vacations: [],
        availability_exceptions: [],
        service_requirements: [
          {
            id: id(63),
            name_ar: "مستلزم اختبار",
            name_en: "Requirement",
            required_during_booking: true,
            fulfillment_mode: "either",
            provider_extra_fee: 20,
          },
        ],
        cancellation_reasons: [
          {
            id: id(61),
            name_ar: "سبب اختبار",
            name_en: "Reason",
            requires_note: true,
            applicable_statuses: ["pending", "confirmed"],
          },
        ],
        profiles: [{ id: uid, full_name: "حساب اختبار محلي" }],
        user_roles: [{ role: "customer" }],
        categories,
        services: url.searchParams.get("category.slug") === "eq.tutoring" ? [] : [service],
        addresses,
        favorites,
        notifications,
        family_members: members,
        bookings:
          url.searchParams.get("select") === "id" ||
          url.searchParams.get("select") === "start_at,end_at"
            ? []
            : [booking],
        payments: paymentRows,
        booking_reschedule_requests: [],
        provider_services: [{ price_override: null, status: "approved", service }],
        reviews: reviewRows,
        provider_teaching_capabilities: scenario === "tutoring" ? [capability] : [],
        teaching_curricula: [
          {
            id: id(51),
            code: "national",
            name_ar: "منهج اختبار",
            name_en: "Curriculum",
            is_active: true,
          },
        ],
        teaching_levels: [
          { id: id(52), code: "g3", name_ar: "صف اختبار", name_en: "Grade", is_active: true },
        ],
        customer_education_profiles: [],
        promo_code_redemptions: [],
        settings: [
          {
            value:
              url.searchParams.get("key") === "eq.billing"
                ? { platform_fee: 25, vat_percent: 14 }
                : url.searchParams.get("key") === "eq.service_areas"
                  ? { areas: [{ name: "Sheikh Zayed", enabled: true }] }
                  : { pending_ttl_hours: 12, min_hours_before_start: 2 },
          },
        ],
      };
      if (!(table in tables)) errors.push(`Unhandled table: ${table}`);
      data = tables[table] || [];
      const filterId = url.searchParams.get("id");
      if (filterId?.startsWith("eq.")) data = data.filter((row) => row.id === filterId.slice(3));
      if (table === "notifications" && url.searchParams.has("read_at"))
        data = data.filter((n) => !n.read_at);
      if (table === "family_members" && url.searchParams.has("is_active"))
        data = data.filter((m) => m.is_active);
      if (table === "addresses" && url.searchParams.get("order")?.startsWith("is_default"))
        data = [...data].sort((a, b) => Number(b.is_default) - Number(a.is_default));
      if (
        mode === "empty" &&
        !["profiles", "user_roles", "settings", "categories", "services"].includes(table)
      )
        data = [];
      if (url.searchParams.get("limit"))
        data = data.slice(0, Number(url.searchParams.get("limit")));
    }
    const count = data.length;
    // PostgREST maybeSingle uses a singular Accept header; browser clients can also
    // request a plain array and transform it locally.
    if (req.headers().accept?.includes("vnd.pgrst.object")) data = data[0] || null;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(0, count - 1)}/${count}`,
        "access-control-expose-headers": "content-range",
      },
      body: method === "HEAD" ? "" : JSON.stringify(data),
    });
  });
  await require("./parity-evidence/local-map.cjs").installLocalMap(context);
  const page = await context.newPage();
  page.on("crash", () =>
    fs.writeFileSync(
      path.join(artifacts, "browser-crash.json"),
      JSON.stringify({ event: "page.crash", step: "booking flow", appErrors: errors }, null, 2),
    ),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error" || mode === "error") return;
    const text = msg.text();
    if (/maps\.googleapis\.com|maps\.google\.com|google\.maps/i.test(text)) return;
    errors.push(text);
  });
  async function visit(route, text) {
    await page.goto(base + route);
    await waitForLaunchGateGone(page);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    const file = path.join(artifacts, `${name}.png`);
    await screenshotWithoutLaunchOverlay(page, file, name);
    screenshots.push({
      screen: name,
      path: file,
      viewport: "390x844",
      language: "ar",
      data: "isolated local test fixtures",
    });
  }

  const ts = require("../../node_modules/typescript");
  const mod = { exports: {} };
  new Function(
    "exports",
    "module",
    ts.transpile(
      fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"),
      { module: ts.ModuleKind.CommonJS },
    ),
  )(mod.exports, mod);
  const ar = mod.exports.default;
  async function button(label) {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  async function radio(label) {
    await page.getByRole("radio", { name: label, exact: true }).click();
  }
  for (const kind of ["hourly", "package", "tutoring"]) {
    scenario = kind;
    paymentRows = [];
    booking.status = "confirmed";
    Object.assign(service, {
      name_ar:
        kind === "tutoring" ? "درس اختبار" : kind === "package" ? "باقة اختبار" : "رعاية بالساعة",
      pricing_model: kind === "package" ? "fixed" : "hourly",
      duration_min: kind === "package" ? 480 : 60,
      fixed_start_time: kind === "package" ? "08:00" : null,
      category: categories[kind === "tutoring" ? 1 : 0],
    });
    provider.category_slug = service.category.slug;
    provider.hourly_rate = kind === "package" ? 800 : 100;
    await visit(`/book/${pid}`, ar.search2.service);
    await expect(page.getByRole("radio", { name: service.name_ar, exact: true })).toBeVisible();
    if (kind === "tutoring") {
      await radio(member.full_name);
      await radio("منهج اختبار");
      await radio("صف اختبار");
      await page.getByRole("radio", { name: /رياضيات اختبار/ }).click();
    }
    await expect(page.getByRole("button", { name: ar.common.continue, exact: true })).toBeEnabled();
    await shot(`${kind}-1-service`);
    await button(ar.common.continue);
    const tomorrow = new Date(Date.now() + 86400000);
    const day = tomorrow.toLocaleDateString("ar-EG-u-nu-latn", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    await button(day);
    await page
      .getByRole("button", { name: /^[0-9]+:[0-9]+/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: ar.common.continue, exact: true })).toBeEnabled();
    await shot(`${kind}-2-time`);
    await button(ar.common.continue);
    if (kind !== "tutoring") await radio(member.full_name);
    await page.getByRole("radio", { name: new RegExp(ar.mobileBooking.providerProvides) }).click();
    await expect(page.getByRole("button", { name: ar.common.continue, exact: true })).toBeEnabled();
    await shot(`${kind}-3-address-recipient`);
    await button(ar.common.continue);
    await button(ar.customerBooking.promo);
    await page.getByLabel(ar.mobileBooking.promo, { exact: true }).fill("LOCALTEST");
    await button(ar.mobileBooking.applyPromo);
    await expect(
      page.getByText(ar.bookFlow.promoApplied.split("{{")[0], { exact: false }).first(),
    ).toBeVisible();
    const method = kind === "hourly" ? "cash" : kind === "package" ? "manual_transfer" : "online";
    const methodName = methodRows.find((m) => m.method_type === method).name_ar;
    await radio(methodName);
    await shot(`${kind}-4-review-payment`);
    await button(ar.mobileBooking.confirmBooking);
    await expect(page).toHaveURL(new RegExp("/booking/" + bid), { timeout: 20000 });
    await expect(page.getByText(methodName, { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByText(methodName, { exact: true }).scrollIntoViewIfNeeded();
    await (
      kind === "hourly"
        ? page.getByText(ar.mobileBooking.cashNext, { exact: true })
        : page.getByRole("button", {
            name: kind === "package" ? ar.payment.uploadReceipt : ar.mobileBooking.payOnline,
            exact: true,
          })
    ).scrollIntoViewIfNeeded();
    await shot(`${kind}-5-payment`);
    if (kind === "package") {
      const chooser = page.waitForEvent("filechooser");
      await button(ar.payment.uploadReceipt);
      const fileChooser = await chooser;
      await fileChooser.setFiles({
        name: "receipt.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await expect(page.getByText(ar.payment.receiptUploaded, { exact: true })).toBeVisible();
      assert.equal(receiptUploads, 1);
      await shot("receipt-uploaded");
      await expect(
        page.getByRole("button", { name: ar.payment.uploadReceipt, exact: true }),
      ).toHaveCount(0);
      await button(ar.payment.viewReceipt);
      await expect.poll(() => signedProofCalls).toBe(1);
      paymentRows[0].proof_path = null;
      await page.reload();
      await expect(
        page.getByRole("button", { name: ar.mobileBooking.uploadPdf, exact: true }),
      ).toBeVisible();
      let pdfChooser = page.waitForEvent("filechooser");
      await button(ar.mobileBooking.uploadPdf);
      await (
        await pdfChooser
      ).setFiles({
        name: "too-large.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65),
      });
      await expect(page.getByText(ar.payment.fileTooLarge, { exact: true })).toBeVisible();
      assert.equal(receiptUploads, 1);
      await shot("receipt-size-limit");
      pdfChooser = page.waitForEvent("filechooser");
      await button(ar.mobileBooking.uploadPdf);
      await (
        await pdfChooser
      ).setFiles({
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\nLocal fixture\n%%EOF"),
      });
      await expect(page.getByText(ar.payment.receiptUploaded, { exact: true })).toBeVisible();
      assert.equal(receiptUploads, 2);
      await shot("pdf-receipt-uploaded");
    }
    if (kind === "hourly") {
      await button(ar.bookingDetail.cancel);
      await radio("سبب اختبار");
      await expect(
        page.getByRole("button", { name: ar.bookingDetail.confirmAction, exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel(ar.bookingDetail.cancelReasonPlaceholder, { exact: true })
        .fill("Local note");
      await shot("cancel-reason");
      await button(ar.bookingDetail.confirmAction);
      assert.equal(booking.status, "cancelled");
      await expect(page.getByTestId("booking-status")).toHaveText(ar.status.cancelled);
      await shot("cancelled");
    }
  }
  assert.equal(creates.length, 3);
  assert.equal(paymobCalls, 1);
  booking.status = "completed";
  await visit(`/booking/${bid}`, ar.status.completed);
  await radio("5");
  await page.getByLabel(ar.mobileBooking.review, { exact: true }).fill("Local review");
  await shot("review-form");
  await button(ar.bookingDetail.submitReview);
  await expect(page.getByText("Local review", { exact: true })).toBeVisible();
  await shot("review-saved");
  await visit("/addresses/new", ar.locationPicker.useMyLocation);
  await radio(ar.customerAreas.sheikhZayed);
  await page.getByLabel(ar.setup.address, { exact: true }).fill("Local street");
  const addressWritesBeforePick = writes.filter(
    (w) => w.table === "addresses" && w.method === "POST",
  ).length;
  await button(ar.locationPicker.useMyLocation);
  await expect(page.getByText(ar.locationPicker.sheetTitle, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: ar.locationPicker.confirm, exact: true }),
  ).toBeEnabled();
  // A GPS result is a draft until the customer explicitly confirms the pin.
  assert.equal(
    writes.filter((w) => w.table === "addresses" && w.method === "POST").length,
    addressWritesBeforePick,
  );
  await button(ar.locationPicker.confirm);
  await expect(page.getByText(ar.locationPicker.saved, { exact: true })).toBeVisible();
  await shot("add-address");
  await button(ar.common.save);
  await expect
    .poll(() => writes.some((w) => w.table === "addresses" && w.method === "POST"))
    .toBeTruthy();
  const savedAddress = writes
    .filter((w) => w.table === "addresses" && w.method === "POST")
    .at(-1).body;
  assert.equal(savedAddress.lat, 30.03);
  assert.equal(savedAddress.lng, 31);
  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(path.join(artifacts, "screenshots.json"), JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        scenarios: 3,
        paymobCalls,
        receiptUploads,
        creates: creates.length,
        screenshots: screenshots.length,
        network: "all remote traffic intercepted",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${screenshots.length} Arabic screenshots; hourly, package, tutoring, cash, transfer, Paymob, receipt, cancel, review, address.`,
  );
}
run()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
