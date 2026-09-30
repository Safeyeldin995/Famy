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

function sendPostgrestError(res, status, message, code = "23514") {
  sendJson(res, status, { message, code, details: null, hint: null });
}

function approvedIdentityDocuments() {
  return [
    {
      id: "doc-front",
      type: "id_card_front",
      status: "approved",
      storage_path: `${MOCK_PROVIDER_ID}/id_card_front/mock.jpg`,
      created_at: "2026-09-01T00:00:00+00:00",
    },
    {
      id: "doc-back",
      type: "id_card_back",
      status: "approved",
      storage_path: `${MOCK_PROVIDER_ID}/id_card_back/mock.jpg`,
      created_at: "2026-09-01T00:00:00+00:00",
    },
  ];
}

function documentsForApprovalScenario(scenario) {
  if (scenario === "docs_pending") {
    return [
      {
        id: "doc-front",
        type: "id_card_front",
        status: "pending",
        storage_path: `${MOCK_PROVIDER_ID}/id_card_front/mock.jpg`,
        created_at: "2026-09-01T00:00:00+00:00",
      },
      {
        id: "doc-back",
        type: "id_card_back",
        status: "approved",
        storage_path: `${MOCK_PROVIDER_ID}/id_card_back/mock.jpg`,
        created_at: "2026-09-01T00:00:00+00:00",
      },
    ];
  }
  if (scenario === "docs_rejected") {
    return [
      {
        id: "doc-front",
        type: "id_card_front",
        status: "rejected",
        storage_path: `${MOCK_PROVIDER_ID}/id_card_front/mock.jpg`,
        created_at: "2026-09-01T00:00:00+00:00",
      },
      {
        id: "doc-back",
        type: "id_card_back",
        status: "approved",
        storage_path: `${MOCK_PROVIDER_ID}/id_card_back/mock.jpg`,
        created_at: "2026-09-01T00:00:00+00:00",
      },
    ];
  }
  return approvedIdentityDocuments();
}

function completionForApprovalScenario(scenario) {
  if (scenario === "incomplete") {
    return { ok: true, complete: false, errors: { experience: "experience_incomplete" } };
  }
  return { ok: true, complete: true, errors: {} };
}

function usesAdminApprovalHarness(state) {
  return (
    typeof state.adminApprovalScenario === "string" && state.adminApprovalScenario !== "legacy"
  );
}

function usesFamilyMembersHarness(state) {
  return state.scenario === "family-members-populated" || state.scenario === "family-members-empty";
}

function seedFamilyMembersForScenario(scenario) {
  if (scenario === "family-members-empty") return [];
  if (scenario === "family-members-populated") {
    return [
      {
        id: "child-1",
        customer_id: MOCK_USER_ID,
        full_name: "Layla",
        relationship: "daughter",
        relationship_other: null,
        date_of_birth: "2024-09-28",
        gender: null,
        phone: null,
        allergies: null,
        medical_notes: null,
        access_notes: null,
        emergency_contact_name: null,
        emergency_contact_phone: null,
        is_active: true,
        created_at: "2026-09-01T00:00:00+00:00",
        updated_at: "2026-09-01T00:00:00+00:00",
      },
    ];
  }
  return null;
}

export function buildAdminProviderDetail(state) {
  const scenario = state.adminApprovalScenario;
  const documents = documentsForApprovalScenario(scenario);
  return {
    id: MOCK_PROVIDER_ID,
    profile_id: MOCK_USER_ID,
    bio_en: "Persisted EN bio issue68",
    bio_ar: "سيرة عربية محفوظة",
    years_experience: 9,
    languages: ["arabic", "english"],
    city: "Maadi",
    hourly_rate: 120,
    onboarding_status: "UNDER_REVIEW",
    submitted_at: "2026-09-01T10:00:00+00:00",
    is_verified: false,
    is_active: true,
    profile: {
      id: MOCK_USER_ID,
      full_name: "Mona Adel",
      phone: "+201026868002",
      email: "issue68@famio.local",
      avatar_url: "avatars/test.jpg",
    },
    documents,
    services: [],
    trust: { score: 80 },
    ratings: { rating_avg: 4.5, rating_count: 2 },
  };
}

export function buildAdminOnboardingReviewPayload(state) {
  const scenario = state.adminApprovalScenario;
  const documents = documentsForApprovalScenario(scenario);
  return {
    provider: {
      id: MOCK_PROVIDER_ID,
      onboarding_status: "UNDER_REVIEW",
    },
    profile: {},
    details: null,
    age_group_capabilities: [],
    references: [],
    documents,
    services: [],
    zones: [],
    events: [
      {
        action: "start_review",
        previous_status: "SUBMITTED",
        new_status: "UNDER_REVIEW",
      },
    ],
    completion: completionForApprovalScenario(scenario),
  };
}

function createState(repoRoot) {
  return {
    repoRoot,
    snapshotDelayMs: 0,
    providerDelayMs: 0,
    zonesDelayMs: 0,
    adminApprovalScenario: "legacy",
    adminReviewDelayMs: 0,
    adminApproveReject: null,
    adminDocumentReviewFail: null,
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
    adminActions: [],
    adminReviews: 0,
    adminProviderStatus: "APPROVED",
    lastAdminReview: null,
    log: [],
    snapshotPatch: null,
    lastSnapshot: null,
    adminCatalogServices: null,
    servicePatches: [],
    adminCatalogToggleFail: false,
    serviceRequirementQueries: 0,
    familyMembers: [],
    familyMemberWrites: [],
    familyMemberListReads: 0,
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
  state.adminActions = [];
  state.adminReviews = 0;
  state.adminProviderStatus = "APPROVED";
  state.lastAdminReview = null;
  state.log = [];
  state.snapshotPatch = null;
  state.lastSnapshot = null;
  state.providerStarted = state.scenario !== "new-provider";
  state.adminCatalogServices = null;
  state.servicePatches = [];
  state.adminCatalogToggleFail = false;
  state.serviceRequirementQueries = 0;
  state.familyMemberWrites = [];
  state.familyMemberListReads = 0;
  const familySeed = seedFamilyMembersForScenario(state.scenario);
  state.familyMembers = familySeed ? familySeed.map((row) => ({ ...row })) : [];
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

function buildAdminCatalogCategories() {
  return [
    {
      id: "cat-babysit",
      slug: "babysitting",
      name_en: "Babysitting",
      name_ar: "مجالسة الأطفال",
      is_active: true,
      sort_order: 1,
    },
    {
      id: "cat-tutor",
      slug: "tutoring",
      name_en: "Tutoring",
      name_ar: "دروس خصوصية",
      is_active: true,
      sort_order: 2,
    },
    {
      id: "cat-clean",
      slug: "home-cleaning",
      name_en: "Home Cleaning QA_",
      name_ar: "تنظيف QA_",
      is_active: true,
      sort_order: 3,
    },
  ];
}

function buildAdminCatalogServices() {
  const categories = buildAdminCatalogCategories();
  const cat = Object.fromEntries(categories.map((row) => [row.slug, row]));
  const serviceDefaults = {
    description_en: null,
    description_ar: null,
    base_price: 100,
    duration_min: 60,
    pricing_model: "hourly",
    minimum_price: null,
    maximum_price: null,
    maximum_extras_total: null,
    provider_pricing_allowed: false,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
  };
  return [
    {
      ...serviceDefaults,
      id: "svc-sit",
      category_id: cat.babysitting.id,
      slug: "babysitting",
      name_en: "Babysitting",
      name_ar: "مجالسة الأطفال",
      is_active: true,
      category: {
        id: cat.babysitting.id,
        slug: cat.babysitting.slug,
        name_en: cat.babysitting.name_en,
        name_ar: cat.babysitting.name_ar,
      },
    },
    {
      ...serviceDefaults,
      id: "svc-tutor",
      category_id: cat.tutoring.id,
      slug: "tutoring-hourly",
      name_en: "Tutoring (inactive)",
      name_ar: "دروس (غير نشط)",
      is_active: false,
      category: {
        id: cat.tutoring.id,
        slug: cat.tutoring.slug,
        name_en: cat.tutoring.name_en,
        name_ar: cat.tutoring.name_ar,
      },
    },
    {
      ...serviceDefaults,
      id: "svc-clean",
      category_id: cat["home-cleaning"].id,
      slug: "deep-home-cleaning",
      name_en: "Deep Home Cleaning",
      name_ar: "تنظيف عميق",
      is_active: true,
      category: {
        id: cat["home-cleaning"].id,
        slug: cat["home-cleaning"].slug,
        name_en: cat["home-cleaning"].name_en,
        name_ar: cat["home-cleaning"].name_ar,
      },
    },
    {
      ...serviceDefaults,
      id: "svc-clean-off",
      category_id: cat["home-cleaning"].id,
      slug: "standard-cleaning-inactive",
      name_en: "Standard Cleaning (inactive)",
      name_ar: "تنظيف عادي (غير نشط)",
      is_active: false,
      category: {
        id: cat["home-cleaning"].id,
        slug: cat["home-cleaning"].slug,
        name_en: cat["home-cleaning"].name_en,
        name_ar: cat["home-cleaning"].name_ar,
      },
    },
    {
      ...serviceDefaults,
      id: "svc-qa",
      category_id: cat["home-cleaning"].id,
      slug: "qa-booking-service-1785235277607",
      name_en: "QA Booking Service",
      name_ar: "خدمة QA",
      is_active: true,
      category: {
        id: cat["home-cleaning"].id,
        slug: cat["home-cleaning"].slug,
        name_en: cat["home-cleaning"].name_en,
        name_ar: cat["home-cleaning"].name_ar,
      },
    },
  ];
}

function ensureAdminCatalogServices(state) {
  if (!state.adminCatalogServices) {
    state.adminCatalogServices = buildAdminCatalogServices();
  }
  return state.adminCatalogServices;
}

function parsePostgrestEqParam(url, key) {
  const raw = url.searchParams.get(key);
  if (!raw?.startsWith("eq.")) return null;
  return raw.slice(3);
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

  if (p === "/rest/v1/rpc/admin_provider_onboarding_review") {
    state.adminReviews += 1;
    if (usesAdminApprovalHarness(state) && state.adminApprovalScenario === "review_error") {
      state.log.push(`adminReviewError#${state.adminReviews}`);
      sendPostgrestError(res, 400, "Review fetch failed", "PGRST116");
      return;
    }
    if (usesAdminApprovalHarness(state) && state.adminReviewDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.adminReviewDelayMs));
    }
    const payload = usesAdminApprovalHarness(state)
      ? buildAdminOnboardingReviewPayload(state)
      : {
          provider: {
            id: MOCK_PROVIDER_ID,
            onboarding_status: state.adminProviderStatus,
          },
          profile: {},
          details: null,
          age_group_capabilities: [],
          references: [],
          documents: [],
          services: [],
          zones: [],
          events: [],
          completion: {},
        };
    state.lastAdminReview = payload;
    state.log.push(`adminReview#${state.adminReviews}`);
    sendJson(res, 200, payload);
    return;
  }

  if (p === "/rest/v1/rpc/admin_provider_onboarding_action") {
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      payload = { raw: raw.toString("utf8") };
    }
    state.adminActions.push(payload);
    state.log.push("adminOnboardingAction");
    if (payload.p_action === "approve" && state.adminApproveReject === "incomplete") {
      sendPostgrestError(res, 400, "Application is incomplete and cannot be approved.", "23514");
      return;
    }
    if (payload.p_action === "request_updated_details") {
      state.adminProviderStatus = "NEEDS_CHANGES";
    }
    sendJson(res, 200, null);
    return;
  }

  if (p === "/rest/v1/rpc/admin_review_provider_document") {
    if (state.adminDocumentReviewFail === "reason_required") {
      sendPostgrestError(res, 400, "A reason is required to reject a document.", "23514");
      return;
    }
    if (state.adminDocumentReviewFail === "documents_not_approved") {
      sendPostgrestError(
        res,
        400,
        "Required identity documents must be approved before provider approval.",
        "23514",
      );
      return;
    }
    sendJson(res, 200, null);
    return;
  }

  if (p === "/rest/v1/rpc/provider_marketplace_eligibility") {
    sendJson(res, 200, []);
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
    const row = usesAdminApprovalHarness(state)
      ? buildAdminProviderDetail(state)
      : buildProviderRow();
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

  if (p.startsWith("/rest/v1/categories")) {
    if (state.scenario === "admin-services-catalog") {
      sendJson(res, 200, buildAdminCatalogCategories());
      return;
    }
  }

  if (p.startsWith("/rest/v1/services")) {
    if (state.scenario === "admin-services-catalog") {
      const rows = ensureAdminCatalogServices(state);
      if (method === "PATCH") {
        const serviceId = parsePostgrestEqParam(url, "id");
        const raw = await readBody(req);
        let patch = {};
        try {
          patch = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          patch = {};
        }
        state.servicePatches.push({ id: serviceId, patch });
        state.log.push("servicePatch");
        if (state.adminCatalogToggleFail) {
          sendPostgrestError(res, 400, "Could not update service active status.", "23514");
          return;
        }
        const row = rows.find((entry) => entry.id === serviceId);
        if (row && Object.prototype.hasOwnProperty.call(patch, "is_active")) {
          row.is_active = patch.is_active;
        }
        const payload = { is_active: row?.is_active ?? patch.is_active ?? false };
        if (wantsObject(req)) {
          sendJson(res, 200, payload, { "content-type": "application/vnd.pgrst.object+json" });
        } else {
          sendJson(res, 200, [payload]);
        }
        return;
      }
      sendJson(res, 200, rows);
      return;
    }
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
    if (state.scenario === "admin-services-catalog") {
      if (p.startsWith("/rest/v1/provider_services") && method === "GET") {
        state.serviceRequirementQueries += 1;
        state.log.push("providerServicesDetail");
      }
      sendJson(res, 200, []);
      return;
    }
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
    if (usesFamilyMembersHarness(state)) {
      if (method === "GET") {
        state.familyMemberListReads += 1;
        state.log.push("familyMemberList");
        let rows = state.familyMembers.filter((row) => row.customer_id === MOCK_USER_ID);
        if (url.search.includes("is_active=eq.true")) {
          rows = rows.filter((row) => row.is_active);
        }
        sendJson(res, 200, rows);
        return;
      }
      if (method === "POST") {
        const raw = await readBody(req);
        let body = {};
        try {
          body = JSON.parse(raw.toString("utf8") || "{}");
        } catch {
          body = {};
        }
        state.familyMemberWrites.push(body);
        state.log.push("familyMemberInsert");
        const row = {
          id: `fm-${state.familyMembers.length + 1}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_active: true,
          relationship_other: null,
          gender: null,
          phone: null,
          allergies: null,
          medical_notes: null,
          access_notes: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          ...body,
        };
        state.familyMembers.unshift(row);
        if (wantsObject(req)) {
          sendJson(res, 201, row, { "content-type": "application/vnd.pgrst.object+json" });
        } else {
          sendJson(res, 201, [row]);
        }
        return;
      }
    }
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
    sendJson(res, 200, [
      {
        id: "rule-1",
        provider_id: MOCK_PROVIDER_ID,
        weekday: 1,
        start_time: "09:00:00",
        end_time: "17:00:00",
      },
    ]);
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
    if (state.scenario === "admin-services-catalog") {
      state.serviceRequirementQueries += 1;
      state.log.push("serviceRequirements");
    }
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
              body.scenario === "book-cleaning" ||
              body.scenario === "admin-services-catalog" ||
              body.scenario === "family-members-populated" ||
              body.scenario === "family-members-empty"
                ? body.scenario
                : "default";
            resetCounts(state);
            state.bookKind = body.scenario === "book-babysitting" ? "babysitting" : "cleaning";
            state.adminCatalogToggleFail = body.adminCatalogToggleFail === true;
            state.snapshotDelayMs = Number(body.snapshotDelayMs) || 0;
            state.providerDelayMs = Number(body.providerDelayMs) || 0;
            state.zonesDelayMs = Number(body.zonesDelayMs) || 0;
            state.adminApprovalScenario =
              typeof body.adminApprovalScenario === "string"
                ? body.adminApprovalScenario
                : "legacy";
            state.adminReviewDelayMs = Number(body.adminReviewDelayMs) || 0;
            state.adminApproveReject =
              body.adminApproveReject === "incomplete" ? "incomplete" : null;
            state.adminDocumentReviewFail =
              body.adminDocumentReviewFail === "reason_required" ||
              body.adminDocumentReviewFail === "documents_not_approved"
                ? body.adminDocumentReviewFail
                : null;
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
              adminActions: state.adminActions,
              adminReviews: state.adminReviews,
              adminProviderStatus: state.adminProviderStatus,
              adminApprovalScenario: state.adminApprovalScenario,
              lastAdminReview: state.lastAdminReview,
              saves: state.saves,
              log: state.log,
              scenario: state.scenario,
              providerStarted: state.providerStarted,
              lastSnapshot: state.lastSnapshot,
              servicePatches: state.servicePatches,
              serviceRequirementQueries: state.serviceRequirementQueries,
              adminCatalogToggleFail: state.adminCatalogToggleFail,
              familyMemberWrites: state.familyMemberWrites,
              familyMemberListReads: state.familyMemberListReads,
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
