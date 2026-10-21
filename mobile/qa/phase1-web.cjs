/* Local-only UI fixtures. Nothing here ships in the app or contacts Supabase.
 * Run from mobile: node qa/phase1-web.cjs <export-directory> <artifact-directory>
 */
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
    permissions: ["clipboard-read", "clipboard-write"],
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
      if (table === "search_marketplace_providers") data = mode === "empty" ? [] : [provider];
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
        payment_methods: [],
        cancellation_reasons: [],
        profiles: [{ id: uid, full_name: "حساب اختبار محلي" }],
        user_roles: [{ role: "customer" }],
        categories,
        services: url.searchParams.get("category.slug") === "eq.tutoring" ? [] : [service],
        addresses,
        favorites,
        notifications,
        family_members: members,
        bookings: [
          booking,
          {
            ...booking,
            id: id(12),
            status: "completed",
            start_at: "2026-01-01T10:00:00Z",
            end_at: "2026-01-01T11:00:00Z",
          },
        ],
        payments: [
          {
            id: id(13),
            booking_id: bid,
            status: "pending",
            amount: 150,
            payment_method_name_ar: "نقدا",
            created_at: now,
          },
        ],
        provider_services: [{ price_override: null, status: "approved", service }],
        reviews: [{ id: id(14), rating: 5, comment: "تقييم اختبار محلي.", created_at: now }],
        provider_teaching_capabilities: [],
        teaching_curricula: [],
        teaching_levels: [],
        customer_education_profiles: [],
        promo_code_redemptions: [],
        settings:
          url.searchParams.get("key") === "eq.support_contact"
            ? [{ value: { phone: "+19999999999", whatsapp: "19999999999" } }]
            : [
                {
                  value: {
                    body_ar:
                      "محتوى اختبار محلي للتحقق من عرض النصوص القانونية. لا يمثل سياسة منشورة.",
                    body_en: "Local content rendering fixture.",
                  },
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
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && mode !== "error") errors.push(msg.text());
  });
  async function visit(route, text) {
    await page.goto(base + route);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
  }
  async function shot(name) {
    const file = path.join(artifacts, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    screenshots.push({
      screen: name,
      path: file,
      viewport: "390x844",
      language: "ar",
      data: "isolated local test fixtures",
    });
  }
  const screens = [
    ["home", "/home", "محتاجة"], // The exact locale headline is read below instead.
    ["search", "/search", ""],
    ["category-babysitting", "/category/babysitting", ""],
    ["category-tutoring", "/category/tutoring", ""],
    ["provider", `/provider/${pid}`, provider.full_name],
    ["legacy-booking-redirect", "/booking-coming-soon", ""],
    ["bookings", "/bookings", ""],
    ["booking-detail", `/booking/${bid}`, provider.full_name],
    ["notifications", "/notifications", notifications[0].title_ar],
    ["profile", "/profile", "حساب اختبار محلي"],
    ["addresses", "/addresses", addresses[0].area],
    ["family-members", "/family-members", member.full_name],
    ["family-member-new", "/family-members/new", ""],
    ["family-member-edit", `/family-members/${mid}`, ""],
    ["favorites", "/favorites", ""],
    ["promo-codes", "/promo-codes", "LOCALTEST"],
    ["help", "/help", ""],
    ["terms", "/content/terms", "محتوى اختبار"],
    ["privacy", "/content/privacy", "محتوى اختبار"],
  ];
  // Load the actual shared strings instead of hardcoding unstable test locators.
  const ts = require("../../node_modules/typescript");
  const localeModule = { exports: {} };
  new Function(
    "exports",
    "module",
    ts.transpile(
      fs.readFileSync(path.resolve(__dirname, "../../src/lib/i18n/locales/ar.ts"), "utf8"),
      { module: ts.ModuleKind.CommonJS },
    ),
  )(localeModule.exports, localeModule);
  const ar = localeModule.exports.default;
  const titles = {
    home: ar.home.headline,
    "legacy-booking-redirect": ar.search.title,
    search: ar.search.title,
    "category-babysitting": service.name_ar,
    "category-tutoring": ar.studentEducation.studentPicker,
    bookings: ar.bookings.title,
    "family-member-new": ar.familyMembers.fullName,
    "family-member-edit": ar.familyMembers.fullName,
    favorites: ar.profile.favorites,
    help: ar.helpC.title,
    terms: "محتوى اختبار محلي للتحقق من عرض النصوص القانونية.",
    privacy: "محتوى اختبار محلي للتحقق من عرض النصوص القانونية.",
  };
  for (const [name, route, text] of screens) {
    await visit(route, titles[name] || text);
    if (name === "home") await expect(page.getByTestId("home-unread")).toBeVisible();
    await shot(name);
  }
  await visit(`/provider/${pid}`, provider.full_name);
  await page.getByRole("button", { name: ar.mobile.favorite, exact: true }).click();
  await expect(page.getByRole("button", { name: ar.mobile.unfavorite, exact: true })).toBeVisible();
  assert(writes.some((w) => w.table === "favorites" && w.method === "POST"));
  await visit("/favorites", provider.full_name);
  await shot("favorites-populated");
  await visit("/notifications", notifications[0].title_ar);
  await page.getByRole("button", { name: ar.notifs.markAllRead, exact: true }).click();
  await expect(page.getByRole("button", { name: ar.notifs.markAllRead, exact: true })).toHaveCount(
    0,
  );
  assert(writes.some((w) => w.table === "notifications" && w.method === "PATCH"));
  await visit("/addresses", addresses[0].area);
  await page.getByRole("button", { name: ar.mobile.setDefault, exact: true }).click();
  await expect(page.getByText(ar.mobile.defaultAddress, { exact: true })).toHaveCount(1);
  assert(writes.some((w) => w.table === "addresses" && w.body?.is_default === true));
  await visit("/family-members/new", ar.familyMembers.fullName);
  await page.getByLabel(ar.familyMembers.fullName, { exact: true }).fill("عضو اختبار");
  await expect(page.getByLabel(ar.familyMembers.dateOfBirth, { exact: true })).toHaveAttribute(
    "type",
    "date",
  );
  await page.getByLabel(ar.familyMembers.dateOfBirth, { exact: true }).fill("2099-02-01");
  await page.getByRole("button", { name: ar.common.save, exact: true }).click();
  await expect(page.getByText(ar.mobile.memberInvalid, { exact: true })).toBeVisible();
  assert(!writes.some((w) => w.table === "family_members"));
  await page.getByLabel(ar.familyMembers.dateOfBirth, { exact: true }).fill("2019-02-03");
  await page.getByLabel(ar.familyMembers.allergies, { exact: true }).fill("اختبار");
  await page.getByRole("button", { name: ar.common.save, exact: true }).click();
  assert(!writes.some((w) => w.table === "family_members"));
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: ar.common.save, exact: true }).click();
  await expect(page.getByText("عضو اختبار", { exact: true })).toBeVisible();
  assert(writes.some((w) => w.table === "family_members" && w.method === "POST"));
  await page.getByRole("button", { name: ar.common.delete, exact: true }).first().click();
  await expect(page.getByText(ar.familyMembers.deactivateTitle, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: ar.common.delete, exact: true }).first().click();
  await expect(page.getByText(ar.familyMembers.inactive, { exact: true })).toBeVisible();
  assert(
    writes.some(
      (w) => w.table === "family_members" && w.method === "PATCH" && w.body.is_active === false,
    ),
  );
  assert(!writes.some((w) => w.table === "family_members" && w.method === "DELETE"));
  await visit("/promo-codes", "LOCALTEST");
  await page.getByRole("button", { name: ar.mobile.copyCode, exact: true }).click();
  await expect(page.getByRole("button", { name: ar.mobile.copied, exact: true })).toBeVisible();
  mode = "empty";
  await visit("/addresses", ar.customerHome.addressHint);
  await shot("addresses-empty");
  mode = "error";
  await visit("/addresses", ar.common.somethingWentWrong);
  await shot("addresses-error");
  assert(failures > 0);
  mode = "populated";
  await page.getByRole("button", { name: ar.common.retry, exact: true }).click();
  await expect(page.getByText(addresses[0].area, { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(artifacts, "screenshots.json"), JSON.stringify(screenshots, null, 2));
  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        screenshots: screenshots.length,
        viewport: "390x844",
        language: "ar",
        network: "all remote traffic intercepted; no live data accessed",
        checks: [
          "all screens render",
          "favorite toggle",
          "mark all notifications read",
          "default address",
          "invalid DOB rejected",
          "health consent required",
          "family create",
          "soft removal",
          "promo copy",
          "empty state",
          "error retry",
        ],
        writes: writes.map(({ table, method }) => ({ table, method })),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${screenshots.length} Arabic screenshots; Phase 1 interactions passed; no remote requests.`,
  );
}
run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    server.close();
  });
