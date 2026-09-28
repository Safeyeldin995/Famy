import http from "node:http";
import https from "node:https";
import { collectIssue68Identity } from "./identity.mjs";
import { MOCK_PROVIDER_ID, MOCK_USER_ID } from "./constants.mjs";

function isAllowedHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function urlHost(raw) {
  try {
    return new URL(raw, "http://127.0.0.1").hostname;
  } catch {
    return "";
  }
}

function extractRequestUrl(args) {
  const first = args[0];
  if (typeof first === "string" || first instanceof URL) return String(first);
  if (first && typeof first === "object") {
    if (typeof first.href === "string") return first.href;
    const protocol = first.protocol || "http:";
    const host = first.hostname || first.host || "127.0.0.1";
    const port = first.port ? `:${first.port}` : "";
    const reqPath = first.path || first.pathname || "/";
    return `${protocol}//${host}${port}${reqPath}`;
  }
  return "";
}

function wrapOutgoing(moduleRef, state) {
  const originalRequest = moduleRef.request;
  const originalGet = moduleRef.get;
  moduleRef.request = function issue68GuardedRequest(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalRequest.apply(this, args);
      req.destroy(new Error(`[issue68-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalRequest.apply(this, args);
  };
  moduleRef.get = function issue68GuardedGet(...args) {
    const url = extractRequestUrl(args);
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      const req = originalGet.apply(this, args);
      req.destroy(new Error(`[issue68-host] blocked unexpected server request: ${url}`));
      return req;
    }
    return originalGet.apply(this, args);
  };
}

function installOutboundGuard(state) {
  if (globalThis.__issue68OutboundGuard) return;
  globalThis.__issue68OutboundGuard = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url && !isAllowedHost(urlHost(url))) {
      state.unexpectedServer.push(url);
      throw new Error(`[issue68-host] blocked unexpected server fetch: ${url}`);
    }
    return originalFetch(input, init);
  };
  wrapOutgoing(http, state);
  wrapOutgoing(https, state);
}

function createState(repoRoot) {
  return {
    repoRoot,
    snapshotDelayMs: 0,
    providerDelayMs: 0,
    zonesDelayMs: 0,
    scenario: "default",
    bookKind: "cleaning",
    providerStarted: false,
    unexpectedServer: [],
    saves: [],
    snapshot: 0,
    provider: 0,
    startOnboarding: 0,
    savedSelections: 0,
    references: 0,
    storageAvatars: 0,
    profileUpdate: 0,
    prepareDocument: 0,
    storageDocuments: 0,
    finalizeDocument: 0,
    marketplace: 0,
    log: [],
    snapshotPatch: null,
    lastSnapshot: null,
  };
}

function resetCounts(state) {
  state.unexpectedServer = [];
  state.saves = [];
  state.snapshot = 0;
  state.provider = 0;
  state.startOnboarding = 0;
  state.savedSelections = 0;
  state.references = 0;
  state.storageAvatars = 0;
  state.profileUpdate = 0;
  state.prepareDocument = 0;
  state.storageDocuments = 0;
  state.finalizeDocument = 0;
  state.marketplace = 0;
  state.log = [];
  state.snapshotPatch = null;
  state.lastSnapshot = null;
  state.providerStarted = state.scenario !== "new-provider";
}

export function buildSnapshot(patch = null) {
  const base = {
    exists: true,
    provider: {
      id: MOCK_PROVIDER_ID,
      onboarding_status: "DRAFT",
      bio_en: "Persisted EN bio issue68",
      bio_ar: "سيرة عربية محفوظة",
      years_experience: 9,
      languages: ["arabic", "english"],
      city: "Maadi",
      max_children_per_booking: 2,
    },
    profile: {
      full_name: "Mona Adel",
      phone: "+201026868002",
      avatar_url: "avatars/test.jpg",
    },
    details: {
      date_of_birth: "1990-04-18",
      gender: "female",
      governorate: "Cairo",
      area: "Maadi",
      full_address: "Road 9",
      previous_work: "Private homes",
      child_age_groups: [],
      newborn_experience: false,
      first_aid_training: false,
    },
    age_group_capabilities: [{ code: "toddler", years_experience: 4, note: "", verified_at: null }],
    completion: { ok: true, complete: false, errors: {} },
  };
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    provider: { ...base.provider, ...(patch.provider ?? {}) },
    profile: { ...base.profile, ...(patch.profile ?? {}) },
    details: { ...base.details, ...(patch.details ?? {}) },
  };
}

export function buildProviderRow() {
  return {
    id: MOCK_PROVIDER_ID,
    profile_id: MOCK_USER_ID,
    bio_en: "Persisted EN bio issue68",
    bio_ar: "سيرة عربية محفوظة",
    years_experience: 9,
    languages: ["arabic", "english"],
    city: "Maadi",
    onboarding_status: "DRAFT",
    profile: {
      id: MOCK_USER_ID,
      full_name: "Mona Adel",
      phone: "+201026868002",
      avatar_url: "avatars/test.jpg",
    },
  };
}

export function buildProviderServicesRows() {
  return [
    {
      id: "ps-clean",
      provider_id: MOCK_PROVIDER_ID,
      service_id: "svc-clean",
      status: "pending",
      price_override: null,
      flagged_for_review: false,
      rejection_reason: null,
      created_at: "2026-09-01T00:00:00+00:00",
    },
  ];
}

export function buildZoneProviderRows() {
  return [
    {
      id: "zp-maadi",
      provider_id: MOCK_PROVIDER_ID,
      zone_id: "zone-maadi",
      created_at: "2026-09-01T00:00:00+00:00",
    },
    {
      id: "zp-zayed",
      provider_id: MOCK_PROVIDER_ID,
      zone_id: "zone-zayed",
      created_at: "2026-09-01T00:00:00+00:00",
    },
  ];
}

export function buildReferenceRows() {
  return [
    {
      id: "ref-1",
      provider_id: MOCK_PROVIDER_ID,
      full_name: "Nadia Kamal",
      relationship: "former_client",
      phone: "+201011122233",
      notes: "Weekly clean for 6 months",
      sort_order: 1,
      created_at: "2026-09-01T00:00:00+00:00",
      updated_at: "2026-09-01T00:00:00+00:00",
    },
    {
      id: "ref-2",
      provider_id: MOCK_PROVIDER_ID,
      full_name: "Layla Hassan",
      relationship: "neighbor",
      phone: "+201022233344",
      notes: "",
      sort_order: 2,
      created_at: "2026-09-01T00:00:00+00:00",
      updated_at: "2026-09-01T00:00:00+00:00",
    },
  ];
}

function sendNoRowObject(res) {
  sendJson(
    res,
    406,
    {
      code: "PGRST116",
      details: "The result contains 0 rows",
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    },
    { "content-type": "application/vnd.pgrst.object+json; charset=utf-8" },
  );
}

function buildMarketplaceRows() {
  return [
    {
      id: "real-provider-1",
      full_name: "Real Provider",
      bio_en: "Real",
      bio_ar: "Real",
      years_experience: 3,
      category_slug: "home-cleaning",
      service_slug: "deep-home-cleaning",
      service_id: "svc-real",
      service_name_en: "Deep Home Cleaning",
      service_name_ar: "Deep Home Cleaning",
      hourly_rate: 100,
      rating_avg: 4.8,
      rating_count: 10,
      trust_score: 80,
      avatar_url: null,
    },
    {
      id: "fixture-provider-1",
      full_name: "QA Fixture Provider",
      bio_en: "Fixture",
      bio_ar: "Fixture",
      years_experience: 1,
      category_slug: "home-cleaning",
      service_slug: "qa-booking-service-1785235277607",
      service_id: "svc-fixture",
      service_name_en: "QA Booking Service",
      service_name_ar: "QA Booking Service",
      hourly_rate: 100,
      rating_avg: 4.0,
      rating_count: 1,
      trust_score: 50,
      avatar_url: null,
    },
  ];
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function wantsObject(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/vnd.pgrst.object+json");
}

async function handleSupabase(state, req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const method = req.method || "GET";
  const p = url.pathname;

  if (method === "OPTIONS") {
    sendEmpty(res, 204);
    return;
  }

  if (p === "/auth/v1/user" || p.startsWith("/auth/v1/token") || p === "/auth/v1/session") {
    sendJson(res, 200, {
      access_token: "issue68-mock-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "issue68-mock-refresh",
      user: {
        id: MOCK_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "issue68@famio.local",
        phone: "201026868002",
      },
      id: MOCK_USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "issue68@famio.local",
      phone: "201026868002",
    });
    return;
  }

  if (p === "/rest/v1/rpc/provider_onboarding_snapshot") {
    if (state.snapshotDelayMs) await new Promise((r) => setTimeout(r, state.snapshotDelayMs));
    state.snapshot += 1;
    state.log.push(`snapshot#${state.snapshot}`);
    if (state.scenario === "new-provider" && !state.providerStarted) {
      const empty = { exists: false };
      state.lastSnapshot = empty;
      sendJson(res, 200, empty);
      return;
    }
    const payload = buildSnapshot(state.snapshotPatch);
    state.lastSnapshot = payload;
    sendJson(res, 200, payload);
    return;
  }

  if (p === "/rest/v1/rpc/provider_start_onboarding") {
    state.startOnboarding += 1;
    state.providerStarted = true;
    state.log.push("startOnboarding");
    sendJson(res, 200, { ok: true, provider_id: MOCK_PROVIDER_ID });
    return;
  }

  if (p === "/rest/v1/rpc/search_marketplace_providers") {
    state.marketplace += 1;
    state.log.push("marketplace");
    sendJson(res, 200, buildMarketplaceRows());
    return;
  }

  if (p === "/rest/v1/rpc/provider_save_onboarding_section") {
    const raw = await readBody(req);
    try {
      state.saves.push(JSON.parse(raw.toString("utf8") || "{}"));
    } catch {
      state.saves.push({ raw: raw.toString("utf8") });
    }
    state.log.push("save");
    sendJson(res, 200, { ok: true, complete: false, errors: {} });
    return;
  }

  if (p === "/rest/v1/rpc/provider_prepare_document_upload") {
    state.prepareDocument += 1;
    state.log.push("prepareDocument");
    sendJson(res, 200, { path: `${MOCK_USER_ID}/profile_photo/mock.jpg` });
    return;
  }

  if (p === "/rest/v1/rpc/provider_finalize_document_upload") {
    state.finalizeDocument += 1;
    state.log.push("finalizeDocument");
    sendJson(res, 200, "doc-mock-id");
    return;
  }

  if (p.startsWith("/storage/v1/object/sign/")) {
    sendJson(res, 200, { signedURL: "/__issue68/avatar.jpg" });
    return;
  }

  if (p.startsWith("/storage/v1/object/avatars/") && method === "POST") {
    state.storageAvatars += 1;
    state.log.push("storageAvatars");
    await readBody(req);
    sendJson(res, 200, { Key: p.slice("/storage/v1/object/".length) });
    return;
  }

  if (p.startsWith("/storage/v1/object/provider-documents/") && method === "POST") {
    state.storageDocuments += 1;
    state.log.push("storageDocuments");
    await readBody(req);
    sendJson(res, 200, { Key: p.slice("/storage/v1/object/".length) });
    return;
  }

  if (p.startsWith("/rest/v1/providers")) {
    if (state.providerDelayMs) await new Promise((r) => setTimeout(r, state.providerDelayMs));
    state.provider += 1;
    state.log.push(`provider#${state.provider}`);
    if (state.scenario === "new-provider" && !state.providerStarted) {
      if (wantsObject(req)) sendNoRowObject(res);
      else sendJson(res, 200, []);
      return;
    }
    const row = buildProviderRow();
    if (wantsObject(req))
      sendJson(res, 200, row, { "content-type": "application/vnd.pgrst.object+json" });
    else sendJson(res, 200, [row]);
    return;
  }

  if (p.startsWith("/rest/v1/profiles") && (method === "PATCH" || method === "POST")) {
    state.profileUpdate += 1;
    state.log.push("profileUpdate");
    await readBody(req);
    sendEmpty(res, 204);
    return;
  }

  if (p.startsWith("/rest/v1/services")) {
    sendJson(res, 200, [
      {
        id: "svc-clean",
        slug: "deep-home-cleaning",
        name_en: "Deep Home Cleaning",
        name_ar: "Deep Home Cleaning",
        is_active: true,
        category: { slug: "home-cleaning", name_en: "Home Cleaning", name_ar: "Home Cleaning" },
      },
      {
        id: "svc-sit",
        slug: "babysitting",
        name_en: "Babysitting",
        name_ar: "مجالسة الأطفال",
        is_active: true,
        category: { slug: "babysitting", name_en: "Babysitting", name_ar: "مجالسة الأطفال" },
      },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/child_age_groups")) {
    sendJson(res, 200, [
      {
        code: "newborn",
        name_en: "Newborns",
        name_ar: "حديثو الولادة",
        min_months: 0,
        max_months: 2,
        sort_order: 1,
        is_active: true,
      },
      {
        code: "infant",
        name_en: "Infants",
        name_ar: "الرضع",
        min_months: 3,
        max_months: 11,
        sort_order: 2,
        is_active: true,
      },
      {
        code: "toddler",
        name_en: "Toddlers",
        name_ar: "الأطفال الصغار",
        min_months: 12,
        max_months: 35,
        sort_order: 3,
        is_active: true,
      },
      {
        code: "preschool",
        name_en: "Preschool children",
        name_ar: "أطفال ما قبل المدرسة",
        min_months: 36,
        max_months: 71,
        sort_order: 4,
        is_active: true,
      },
      {
        code: "school_age",
        name_en: "School-age children",
        name_ar: "أطفال المدارس",
        min_months: 72,
        max_months: 155,
        sort_order: 5,
        is_active: true,
      },
      {
        code: "teenager",
        name_en: "Teenagers",
        name_ar: "المراهقون",
        min_months: 156,
        max_months: 215,
        sort_order: 6,
        is_active: true,
      },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/zones")) {
    if (state.zonesDelayMs) await new Promise((r) => setTimeout(r, state.zonesDelayMs));
    sendJson(res, 200, [
      { id: "zone-maadi", name_en: "Maadi", name_ar: "Maadi" },
      { id: "zone-zayed", name_en: "Zayed", name_ar: "Zayed" },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/provider_services") || p.startsWith("/rest/v1/zone_providers")) {
    if (state.scenario === "book-babysitting" || state.scenario === "book-cleaning") {
      if (p.startsWith("/rest/v1/zone_providers")) {
        sendJson(res, 200, []);
        return;
      }
      const babysitting = state.bookKind === "babysitting";
      sendJson(res, 200, [
        {
          price_override: 120,
          status: "approved",
          service: {
            id: babysitting ? "svc-sit" : "svc-clean",
            slug: babysitting ? "babysitting" : "deep-home-cleaning",
            name_en: babysitting ? "Babysitting" : "Deep Home Cleaning",
            name_ar: babysitting ? "مجالسة الأطفال" : "Deep Home Cleaning",
            is_active: true,
            category: {
              slug: babysitting ? "babysitting" : "home-cleaning",
              name_en: babysitting ? "Babysitting" : "Home Cleaning",
              name_ar: babysitting ? "مجالسة الأطفال" : "Home Cleaning",
            },
          },
        },
      ]);
      return;
    }
    state.savedSelections += 1;
    state.log.push(
      p.startsWith("/rest/v1/provider_services") ? "provider_services" : "zone_providers",
    );
    if (state.scenario === "saved-data-error") {
      sendJson(res, 500, { code: "PGRST000", message: "Could not query saved selections" });
      return;
    }
    if (state.scenario === "returning") {
      sendJson(
        res,
        200,
        p.startsWith("/rest/v1/provider_services")
          ? buildProviderServicesRows()
          : buildZoneProviderRows(),
      );
      return;
    }
    sendJson(res, 200, []);
    return;
  }

  if (p.startsWith("/rest/v1/provider_references")) {
    state.references += 1;
    state.log.push("provider_references");
    if (state.scenario === "saved-data-error") {
      sendJson(res, 500, { code: "PGRST000", message: "Could not query saved references" });
      return;
    }
    sendJson(res, 200, state.scenario === "returning" ? buildReferenceRows() : []);
    return;
  }

  if (p.startsWith("/rest/v1/provider_documents")) {
    sendJson(res, 200, []);
    return;
  }

  if (p.startsWith("/rest/v1/user_roles")) {
    const role =
      state.scenario === "book-babysitting" || state.scenario === "book-cleaning"
        ? "customer"
        : "provider";
    sendJson(res, 200, [{ role }]);
    return;
  }

  if (p === "/rest/v1/rpc/marketplace_provider_details") {
    const babysitting = state.bookKind === "babysitting";
    sendJson(res, 200, [
      {
        id: MOCK_PROVIDER_ID,
        full_name: "Mona Adel",
        avatar_url: "",
        bio_en: "Persisted EN bio issue68",
        bio_ar: "سيرة عربية محفوظة",
        hourly_rate: 120,
        years_experience: 9,
        languages: ["arabic"],
        city: "Maadi",
        is_top_pro: false,
        is_verified: true,
        response_time_min: 15,
        rating_avg: 4.8,
        rating_count: 10,
        trust_score: 80,
        category_slug: babysitting ? "babysitting" : "home-cleaning",
        service_id: babysitting ? "svc-sit" : "svc-clean",
        service_slug: babysitting ? "babysitting" : "deep-home-cleaning",
        service_name_en: babysitting ? "Babysitting" : "Deep Home Cleaning",
        service_name_ar: babysitting ? "مجالسة الأطفال" : "Deep Home Cleaning",
      },
    ]);
    return;
  }

  if (p === "/rest/v1/rpc/marketplace_provider_booking_settings") {
    sendJson(res, 200, [
      { vacation_mode: false, min_notice_hours: 2, max_advance_days: 12, buffer_minutes: 0 },
    ]);
    return;
  }

  if (p === "/rest/v1/rpc/resolve_zone") {
    sendJson(res, 200, [
      { zone_id: "zone-maadi", name_en: "Maadi", name_ar: "Maadi", travel_fee: 0 },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/addresses")) {
    sendJson(res, 200, [
      {
        id: "addr-1",
        user_id: MOCK_USER_ID,
        label: "Home",
        line1: "Road 9",
        street: "Road 9",
        area: "Maadi",
        city: "Cairo",
        lat: 29.96,
        lng: 31.25,
        is_default: true,
        created_at: "2026-09-01T00:00:00+00:00",
      },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/family_members")) {
    sendJson(res, 200, [
      {
        id: "child-1",
        customer_id: MOCK_USER_ID,
        full_name: "Layla",
        relationship: "daughter",
        date_of_birth: "2024-09-28",
        is_active: true,
      },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/availability_rules")) {
    sendJson(res, 200, [{ start_time: "09:00:00", end_time: "17:00:00" }]);
    return;
  }

  if (
    p.startsWith("/rest/v1/provider_vacations") ||
    p.startsWith("/rest/v1/availability_exceptions")
  ) {
    sendJson(res, 200, []);
    return;
  }

  if (p.startsWith("/rest/v1/bookings")) {
    sendJson(res, 200, []);
    return;
  }

  if (p.startsWith("/rest/v1/payment_methods")) {
    sendJson(res, 200, [
      { id: "pm-1", name_en: "Cash", name_ar: "كاش", is_active: true, is_default: true },
    ]);
    return;
  }

  if (p.startsWith("/rest/v1/settings")) {
    sendJson(res, 200, { value: { platform_fee: 25, vat_percent: 14 } });
    return;
  }

  if (p.startsWith("/rest/v1/service_requirements")) {
    sendJson(res, 200, []);
    return;
  }

  if (p.startsWith("/rest/v1/") || p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/")) {
    sendJson(res, 200, {});
    return;
  }
}

function isHarnessOrMock(pathname) {
  return (
    pathname.startsWith("/__issue68/") ||
    pathname.startsWith("/auth/v1/") ||
    pathname.startsWith("/rest/v1/") ||
    pathname.startsWith("/storage/v1/")
  );
}

export function issue68MockPlugin(repoRoot) {
  const state = createState(repoRoot);
  installOutboundGuard(state);

  return {
    name: "issue68-mock-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          if (!isHarnessOrMock(url.pathname)) {
            next();
            return;
          }

          if (url.pathname === "/__issue68/identity") {
            sendJson(res, 200, collectIssue68Identity(repoRoot));
            return;
          }

          if (url.pathname === "/__issue68/config" && req.method === "POST") {
            const raw = await readBody(req);
            const body = JSON.parse(raw.toString("utf8") || "{}");
            state.scenario =
              body.scenario === "returning" ||
              body.scenario === "new-provider" ||
              body.scenario === "saved-data-error" ||
              body.scenario === "book-babysitting" ||
              body.scenario === "book-cleaning"
                ? body.scenario
                : "default";
            resetCounts(state);
            state.bookKind = body.scenario === "book-babysitting" ? "babysitting" : "cleaning";
            state.snapshotDelayMs = Number(body.snapshotDelayMs) || 0;
            state.providerDelayMs = Number(body.providerDelayMs) || 0;
            state.zonesDelayMs = Number(body.zonesDelayMs) || 0;
            sendJson(res, 200, { ok: true });
            return;
          }

          if (url.pathname === "/__issue68/snapshot" && req.method === "POST") {
            const raw = await readBody(req);
            const body = JSON.parse(raw.toString("utf8") || "{}");
            state.snapshotPatch = body && typeof body === "object" ? body : null;
            sendJson(res, 200, { ok: true });
            return;
          }

          if (url.pathname === "/__issue68/calls") {
            sendJson(res, 200, {
              snapshot: state.snapshot,
              provider: state.provider,
              startOnboarding: state.startOnboarding,
              savedSelections: state.savedSelections,
              references: state.references,
              storageAvatars: state.storageAvatars,
              profileUpdate: state.profileUpdate,
              prepareDocument: state.prepareDocument,
              storageDocuments: state.storageDocuments,
              finalizeDocument: state.finalizeDocument,
              marketplace: state.marketplace,
              saves: state.saves,
              log: state.log,
              scenario: state.scenario,
              providerStarted: state.providerStarted,
              lastSnapshot: state.lastSnapshot,
            });
            return;
          }

          if (url.pathname === "/__issue68/network") {
            sendJson(res, 200, { unexpected: [...state.unexpectedServer] });
            return;
          }

          if (url.pathname === "/__issue68/avatar.jpg") {
            res.writeHead(200, { "content-type": "image/jpeg" });
            res.end(
              Buffer.from(
                "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/9oADAMBAAIQAxAAAAG6P//Z",
                "base64",
              ),
            );
            return;
          }

          await handleSupabase(state, req, res);
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      });
    },
  };
}
