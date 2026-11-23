/** Shared Supabase REST mock for isolated web QA (phase1, home-freeze-diag). */
function createPhase1Data() {
  const config = require("../../app.json").expo.extra;
  const apiOrigin = new URL(config.supabaseUrl).origin;
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const uid = id(1);
  const pid = id(2);
  const bid = id(3);
  const sid = id(4);
  const now = new Date().toISOString();
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
  const addresses = [
    {
      id: id(5),
      customer_id: uid,
      area: "منطقة اختبار",
      label: "المنزل",
      is_default: true,
    },
  ];
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
  const authKey = `sb-${new URL(apiOrigin).hostname.split(".")[0]}-auth-token`;
  return {
    apiOrigin,
    authKey,
    session,
    user,
    uid,
    pid,
    bid,
    categories,
    service,
    provider,
    booking,
    addresses,
    notifications: [
      {
        id: id(10),
        user_id: uid,
        title_ar: "تحديث حجز - اختبار محلي",
        body_ar: "إشعار اختبار",
        title_en: "Local test",
        created_at: now,
        read_at: null,
        deep_link: `/booking/${bid}`,
      },
    ],
    favorites: [],
    members: [],
    id,
  };
}

async function installPhase1SupabaseMock(context, base, errors, extraInit) {
  const data = createPhase1Data();
  const {
    apiOrigin,
    authKey,
    session,
    user,
    uid,
    pid,
    bid,
    categories,
    service,
    provider,
    booking,
    addresses,
    id,
  } = data;

  await context.addInitScript(
    ({ key, session: s, extra }) => {
      localStorage.setItem("famy.lang", "ar");
      localStorage.setItem(key, JSON.stringify(s));
      if (extra?.homeFreezeDiag) localStorage.setItem("famy.homeFreezeDiag", "1");
      if (extra?.homeFreezeLegacy) localStorage.setItem("famy.homeFreezeLegacy", "1");
    },
    {
      key: authKey,
      session,
      extra: extraInit,
    },
  );

  const webOrigin = (require("../../app.json").expo.extra.webOrigin || "").replace(/\/$/, "");

  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (url.origin === webOrigin && url.pathname === "/api/mobile/otp/context" && req.method() === "GET") {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "intent_missing" }),
      });
    }
    if (url.origin !== apiOrigin) {
      errors.push(`Unexpected external request: ${url.pathname}`);
      return route.abort();
    }
    const table = url.pathname.split("/").at(-1);
    const method = req.method();
    const body = method === "GET" || method === "HEAD" ? null : req.postDataJSON();
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ json: url.pathname.endsWith("/user") ? user : session });
    if (!["GET", "HEAD"].includes(method) && !url.pathname.includes("/rpc/")) {
      return route.fulfill({ json: null });
    }
    let rows;
    if (url.pathname.includes("/rpc/")) {
      if (table === "my_unpaid_fees") rows = [];
      else if (table === "get_active_featured_promo_codes") rows = [];
      else if (
        table === "booking_party_profiles" ||
        table === "booking_party_profiles_with_member_age"
      )
        rows = (body?.p_booking_ids || []).map((booking_id) => ({
          booking_id,
          other_name: provider.full_name,
          other_avatar_url: null,
          viewer_role: "customer",
        }));
      else if (table === "search_marketplace_providers") rows = [provider];
      else rows = [];
    } else {
      const tables = {
        conversations: [],
        profiles: [{ id: uid, full_name: "حساب اختبار محلي" }],
        user_roles: [{ role: "customer" }],
        categories,
        services: [service],
        addresses,
        favorites: [],
        notifications: data.notifications,
        family_members: [],
        bookings: [booking],
        payments: [],
        provider_services: [{ price_override: null, status: "approved", service }],
        reviews: [],
        settings: [{ value: { phone: "+19999999999", whatsapp: "19999999999" } }],
        customer_debts: [],
        customer_debt_settlements: [],
        promo_code_redemptions: [],
        zones: [],
      };
      rows = tables[table] || [];
      if (table === "addresses" && url.searchParams.get("order")?.startsWith("is_default")) {
        rows = [...rows].sort((a, b) => Number(b.is_default) - Number(a.is_default));
      }
    }
    const count = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
    let payload = rows;
    if (req.headers().accept?.includes("vnd.pgrst.object")) payload = Array.isArray(rows) ? rows[0] ?? null : rows;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `0-${Math.max(0, count - 1)}/${count}`,
        "access-control-expose-headers": "content-range",
      },
      body: method === "HEAD" ? "" : JSON.stringify(payload),
    });
  });

  return { ...data, authKey };
}

module.exports = { createPhase1Data, installPhase1SupabaseMock };