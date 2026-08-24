import { createClient } from "@supabase/supabase-js";
import {
  PHASE_A_TRUNCATE_ROOTS,
  PLAN_VERSION,
  STORAGE_BUCKETS,
} from "./constants.mjs";
import { loadPublicFkEdges } from "./fk-graph.mjs";
import {
  computeServiceDeleteCascadeTables,
  computeTruncateCascadeClosure,
} from "./fk-closure.mjs";
import { fingerprintSortedIds, SEED_SERVICE_SLUG_SET } from "./seed-catalog.mjs";
import { maskProjectRef } from "./load-production-env.mjs";
import { inventoryStorageBuckets, classifyStorageObject } from "./storage-inventory.mjs";
import {
  AUDIT_TRIGGER_TABLES,
  NO_AUDIT_TRIGGER_TARGETS,
  PHASE_B_AUDIT_WRITERS,
} from "./audit-triggers-catalog.mjs";
import { evaluateCatalogBlockingChecks } from "./blocking-predicates.mjs";
import { fingerprintPlan } from "./fingerprint.mjs";

const AUTH_USERS_MAX_ROWS = 4000;
const AUTH_USERS_PAGE_SIZE = 200;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} table
 */
async function countTable(admin, table) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 */
export async function fetchAllAuthUserIds(admin) {
  /** @type {string[]} */
  const ids = [];
  const maxPages = AUTH_USERS_MAX_ROWS / AUTH_USERS_PAGE_SIZE;
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PAGE_SIZE,
    });
    if (error) throw error;
    ids.push(...data.users.map((user) => user.id));
    if (data.users.length < AUTH_USERS_PAGE_SIZE) {
      return ids;
    }
  }
  throw new Error(
    `[production-reset] auth.users pagination exceeded ${AUTH_USERS_MAX_ROWS} rows — refusing truncated ID set`,
  );
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} table
 * @param {string} [cols]
 */
async function fetchAllRows(admin, table, cols = "*") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** @type {readonly string[]} */
const REPORT_ALLOWLIST = [
  "version",
  "maskedProjectRef",
  "fkGraphSource",
  "linkedRefVerified",
  "blocked",
  "blockedReason",
  "blockedReasons",
  "blockingInputs",
  "phaseA",
  "phaseB",
  "phaseC",
  "phaseD",
  "phaseE",
  "executeOrder",
  "auditTriggerVerification",
  "counts",
  "storage",
  "fingerprint",
];

/**
 * @param {Record<string, unknown>} source
 * @param {readonly string[]} keys
 */
function pickAllowlistedFields(source, keys) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * Row-count map keys must exactly match the programmatic Phase A closure — never a hand-maintained list.
 *
 * @param {Record<string, number>} tableCounts
 * @param {string[]} phaseAClosure
 */
export function assertTableCountsKeysMatchPhaseAClosure(tableCounts, phaseAClosure) {
  const countKeys = new Set(Object.keys(tableCounts));
  const closureKeys = new Set(phaseAClosure);
  const missing = phaseAClosure.filter((table) => !countKeys.has(table));
  const extra = [...countKeys].filter((table) => !closureKeys.has(table));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[production-reset] tableCounts/Phase A closure mismatch — missing: ${missing.join(", ") || "(none)"}; extra: ${extra.join(", ") || "(none)"}`,
    );
  }
}

/**
 * @param {string[]} phaseAClosure
 * @param {Record<string, number>} [countsByTable]
 */
export function buildPhaseATableRowCounts(phaseAClosure, countsByTable = {}) {
  /** @type {Record<string, number>} */
  const tableCounts = {};
  for (const table of phaseAClosure) {
    tableCounts[table] = countsByTable[table] ?? 0;
  }
  assertTableCountsKeysMatchPhaseAClosure(tableCounts, phaseAClosure);
  return tableCounts;
}

/**
 * Sum Phase A public rows for reporting. `zones` rows are counted separately via Phase B zone ID set.
 *
 * @param {Record<string, number>} tableCounts
 * @param {string[]} phaseAClosure
 */
export function computeUserGeneratedPublicRows(tableCounts, phaseAClosure) {
  let sum = 0;
  for (const table of phaseAClosure) {
    if (table === "zones") continue;
    sum += tableCounts[table] ?? 0;
  }
  return sum;
}

/**
 * @param {{ url: string; serviceRoleKey: string; projectRef: string }} env
 * @param {{ loadFk?: typeof loadPublicFkEdges }} [options]
 */
export async function buildProductionResetPlan(env, options = {}) {
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const loadFk = options.loadFk ?? loadPublicFkEdges;
  const { edges, source: fkSource, linkedRefVerified } = loadFk();
  const phaseAClosure = computeTruncateCascadeClosure(edges, [...PHASE_A_TRUNCATE_ROOTS]);
  const phaseBServiceCascadeTables = computeServiceDeleteCascadeTables(edges);

  const services = await fetchAllRows(admin, "services", "id, slug, name_en");
  const seedServices = services.filter((s) => SEED_SERVICE_SLUG_SET.has(s.slug));
  const deleteServices = services.filter((s) => !SEED_SERVICE_SLUG_SET.has(s.slug));

  const zones = await fetchAllRows(admin, "zones", "id, name_en");

  const requirements = await fetchAllRows(admin, "service_requirements", "id, service_id");
  const deleteServiceIds = new Set(deleteServices.map((s) => s.id));
  const requirementsOnDelete = requirements.filter((r) => deleteServiceIds.has(r.service_id));

  const blocking = evaluateCatalogBlockingChecks({
    phaseAClosure,
    seedServices,
    deleteServices,
    zones,
  });

  const tableCounts = {};
  for (const table of phaseAClosure) {
    tableCounts[table] = await countTable(admin, table);
  }
  assertTableCountsKeysMatchPhaseAClosure(tableCounts, phaseAClosure);
  const userRowSum = computeUserGeneratedPublicRows(tableCounts, phaseAClosure);

  const authUserIds = await fetchAllAuthUserIds(admin);

  const profiles = await fetchAllRows(admin, "profiles", "id");
  const profileIds = new Set(profiles.map((p) => p.id));
  const providers = await fetchAllRows(admin, "providers", "id");
  const providerIds = new Set(providers.map((p) => p.id));
  const bookings = await fetchAllRows(admin, "bookings", "id");
  const bookingIds = new Set(bookings.map((b) => b.id));

  const storage = await inventoryStorageBuckets(admin, STORAGE_BUCKETS);
  /** @type {Array<{ bucket: string; key: string }>} */
  const storageObjects = [];
  let storageTotal = 0;
  const storageByClass = {};
  for (const bucket of STORAGE_BUCKETS) {
    for (const obj of storage[bucket].keys) {
      storageTotal++;
      storageObjects.push({ bucket, key: obj.key });
      const cls = classifyStorageObject(bucket, obj.key, profileIds, providerIds, bookingIds);
      storageByClass[cls] = (storageByClass[cls] ?? 0) + 1;
    }
  }

  const avatarAuthOnlySample = [];
  for (const obj of storage.avatars.keys) {
    const uid = obj.key.split("/")[0];
    if (!profileIds.has(uid)) {
      const { data, error } = await admin.auth.admin.getUserById(uid);
      avatarAuthOnlySample.push({
        maskedId: uid.slice(0, 4) + "…" + uid.slice(-4),
        hasAuthUser: !error && !!data?.user,
      });
    }
  }

  const scopedPublicRows =
    userRowSum + deleteServices.length + zones.length + requirementsOnDelete.length;

  /** @type {const} */
  const executeOrder = [
    "Phase A: TRUNCATE phaseA.truncateRoots CASCADE (closure tables)",
    "Phase B: DELETE fingerprinted non-seed services (fires trg_audit_services)",
    "Phase B2: TRUNCATE audit_logs (post-service-delete, pre-auth)",
    "Phase C: DELETE all auth.users via Auth Admin API",
    "Phase D: TRUNCATE audit_logs (final safety-net verify/clear)",
    "Phase E: DELETE all storage objects in four buckets",
  ];

  /** @type {const} */
  const plan = {
    version: PLAN_VERSION,
    maskedProjectRef: maskProjectRef(env.projectRef),
    fkGraphSource: fkSource,
    linkedRefVerified,
    blocked: blocking.blocked,
    blockedReason: blocking.blockedReason,
    blockedReasons: blocking.blockedReasons,
    blockingInputs: blocking.blockingInputs,
    phaseA: {
      truncateRoots: [...PHASE_A_TRUNCATE_ROOTS],
      truncateCascadeClosure: phaseAClosure,
      truncateCascadeClosureCount: phaseAClosure.length,
    },
    phaseB: {
      serviceDeleteCount: deleteServices.length,
      serviceKeepCount: seedServices.length,
      serviceDeleteFingerprint: null,
      serviceKeepFingerprint: null,
      zoneDeleteCount: zones.length,
      zoneQaShapedCount: blocking.blockingInputs.zoneQaShapedCount,
      zoneDeleteFingerprint: null,
      serviceRequirementDeleteCount: requirementsOnDelete.length,
      serviceRequirementDeleteFingerprint: null,
      serviceDeleteCascadeTables: phaseBServiceCascadeTables,
      auditWriters: PHASE_B_AUDIT_WRITERS,
    },
    phaseC: {
      authUsersDeleteCount: authUserIds.length,
      requiresAuditClearBefore: true,
    },
    phaseD: {
      auditLogsFinalClear: true,
      description: "Safety-net audit_logs verify/clear after auth.users deletion",
    },
    phaseE: {
      storageBuckets: STORAGE_BUCKETS,
      storageObjectCount: storageTotal,
      storagePreserveCount: 0,
    },
    executeOrder,
    auditTriggerVerification: {
      catalogTablesWithAuditTriggers: AUDIT_TRIGGER_TABLES.length,
      noAuditOn: NO_AUDIT_TRIGGER_TARGETS,
      phaseBWritesAudit: PHASE_B_AUDIT_WRITERS,
    },
    counts: {
      userGeneratedPublicRows: userRowSum,
      auditLogs: tableCounts.audit_logs,
      auditLogsPctOfUserRows: ((tableCounts.audit_logs / userRowSum) * 100).toFixed(2) + "%",
      qaServicesDelete: deleteServices.length,
      zonesDelete: zones.length,
      serviceRequirementsDelete: requirementsOnDelete.length,
      bookingLocations: tableCounts.booking_locations,
      scopedPublicRowRemovals: scopedPublicRows,
      authUsers: authUserIds.length,
      storageObjects: storageTotal,
      tableCounts,
    },
    storage: {
      byBucket: Object.fromEntries(
        STORAGE_BUCKETS.map((b) => [b, { total: storage[b].total }]),
      ),
      classification: storageByClass,
      avatarAuthOnlyNoProfile: avatarAuthOnlySample,
    },
    fingerprint: null,
  };

  if (!blocking.blocked) {
    plan.fingerprint = fingerprintPlan({
      version: plan.version,
      projectRef: env.projectRef,
      fkGraphSource: fkSource,
      fkEdges: edges,
      phaseATruncateRoots: plan.phaseA.truncateRoots,
      phaseAClosure,
      tableCounts,
      serviceDeleteIds: deleteServices.map((s) => s.id),
      serviceKeepIds: seedServices.map((s) => s.id),
      serviceRequirementDeleteIds: requirementsOnDelete.map((r) => r.id),
      zoneDeleteIds: zones.map((z) => z.id),
      authUserIds,
      storageObjects,
      executeOrder: [...executeOrder],
      blockingInputs: blocking.blockingInputs,
    });
    plan.phaseB.serviceDeleteFingerprint = fingerprintSortedIds(deleteServices.map((s) => s.id));
    plan.phaseB.serviceKeepFingerprint = fingerprintSortedIds(seedServices.map((s) => s.id));
    plan.phaseB.zoneDeleteFingerprint = fingerprintSortedIds(zones.map((z) => z.id));
    plan.phaseB.serviceRequirementDeleteFingerprint = fingerprintSortedIds(
      requirementsOnDelete.map((r) => r.id),
    );
  }

  return plan;
}

/**
 * @param {Awaited<ReturnType<typeof buildProductionResetPlan>>} plan
 */
export function sanitizePlanForReport(plan) {
  return pickAllowlistedFields(plan, REPORT_ALLOWLIST);
}

/**
 * @param {{ blocked: boolean }} plan
 */
export function dryRunExitCode(plan) {
  return plan.blocked ? 2 : 0;
}

/**
 * Build a plan from an in-memory snapshot (unit tests only).
 *
 * @param {{
 *   projectRef: string;
 *   fkGraphSource?: "pg_constraint" | "migrations";
 *   linkedRefVerified?: boolean;
 *   edges: import("./fk-graph.mjs").FkEdge[];
 *   services: Array<{ id: string; slug: string; name_en?: string | null }>;
 *   zones: Array<{ id: string; name_en?: string | null }>;
 *   serviceRequirements?: Array<{ id: string; service_id: string }>;
 *   authUserIds?: string[];
 *   storageObjects?: Array<{ bucket: string; key: string }>;
 *   tableCounts?: Record<string, number>;
 * }} snapshot
 */
export function buildProductionResetPlanFromSnapshot(snapshot) {
  const phaseAClosure = computeTruncateCascadeClosure(snapshot.edges, [...PHASE_A_TRUNCATE_ROOTS]);
  const phaseBServiceCascadeTables = computeServiceDeleteCascadeTables(snapshot.edges);

  const seedServices = snapshot.services.filter((s) => SEED_SERVICE_SLUG_SET.has(s.slug));
  const deleteServices = snapshot.services.filter((s) => !SEED_SERVICE_SLUG_SET.has(s.slug));
  const requirements = snapshot.serviceRequirements ?? [];
  const deleteServiceIds = new Set(deleteServices.map((s) => s.id));
  const requirementsOnDelete = requirements.filter((r) => deleteServiceIds.has(r.service_id));

  const blocking = evaluateCatalogBlockingChecks({
    phaseAClosure,
    seedServices,
    deleteServices,
    zones: snapshot.zones,
  });

  const tableCounts = buildPhaseATableRowCounts(phaseAClosure, snapshot.tableCounts ?? {});
  const userRowSum = computeUserGeneratedPublicRows(tableCounts, phaseAClosure);
  const authUserIds = snapshot.authUserIds ?? [];
  const storageObjects = snapshot.storageObjects ?? [];

  const executeOrder = [
    "Phase A: TRUNCATE phaseA.truncateRoots CASCADE (closure tables)",
    "Phase B: DELETE fingerprinted non-seed services (fires trg_audit_services)",
    "Phase B2: TRUNCATE audit_logs (post-service-delete, pre-auth)",
    "Phase C: DELETE all auth.users via Auth Admin API",
    "Phase D: TRUNCATE audit_logs (final safety-net verify/clear)",
    "Phase E: DELETE all storage objects in four buckets",
  ];

  const plan = {
    version: PLAN_VERSION,
    maskedProjectRef: maskProjectRef(snapshot.projectRef),
    fkGraphSource: snapshot.fkGraphSource ?? "migrations",
    linkedRefVerified: snapshot.linkedRefVerified ?? false,
    blocked: blocking.blocked,
    blockedReason: blocking.blockedReason,
    blockedReasons: blocking.blockedReasons,
    blockingInputs: blocking.blockingInputs,
    phaseA: {
      truncateRoots: [...PHASE_A_TRUNCATE_ROOTS],
      truncateCascadeClosure: phaseAClosure,
      truncateCascadeClosureCount: phaseAClosure.length,
    },
    phaseB: {
      serviceDeleteCount: deleteServices.length,
      serviceKeepCount: seedServices.length,
      serviceDeleteFingerprint: null,
      serviceKeepFingerprint: null,
      zoneDeleteCount: snapshot.zones.length,
      zoneQaShapedCount: blocking.blockingInputs.zoneQaShapedCount,
      zoneDeleteFingerprint: null,
      serviceRequirementDeleteCount: requirementsOnDelete.length,
      serviceRequirementDeleteFingerprint: null,
      serviceDeleteCascadeTables: phaseBServiceCascadeTables,
      auditWriters: PHASE_B_AUDIT_WRITERS,
    },
    phaseC: {
      authUsersDeleteCount: authUserIds.length,
      requiresAuditClearBefore: true,
    },
    phaseD: {
      auditLogsFinalClear: true,
      description: "Safety-net audit_logs verify/clear after auth.users deletion",
    },
    phaseE: {
      storageBuckets: STORAGE_BUCKETS,
      storageObjectCount: storageObjects.length,
      storagePreserveCount: 0,
    },
    executeOrder,
    auditTriggerVerification: {
      catalogTablesWithAuditTriggers: AUDIT_TRIGGER_TABLES.length,
      noAuditOn: NO_AUDIT_TRIGGER_TARGETS,
      phaseBWritesAudit: PHASE_B_AUDIT_WRITERS,
    },
    counts: {
      userGeneratedPublicRows: userRowSum,
      auditLogs: tableCounts.audit_logs ?? 0,
      auditLogsPctOfUserRows: "0.00%",
      qaServicesDelete: deleteServices.length,
      zonesDelete: snapshot.zones.length,
      serviceRequirementsDelete: requirementsOnDelete.length,
      bookingLocations: tableCounts.booking_locations ?? 0,
      scopedPublicRowRemovals:
        userRowSum +
        deleteServices.length +
        snapshot.zones.length +
        requirementsOnDelete.length,
      authUsers: authUserIds.length,
      storageObjects: storageObjects.length,
      tableCounts,
    },
    storage: {
      byBucket: {},
      classification: {},
      avatarAuthOnlyNoProfile: [],
    },
    fingerprint: null,
  };

  if (!blocking.blocked) {
    plan.fingerprint = fingerprintPlan({
      version: plan.version,
      projectRef: snapshot.projectRef,
      fkGraphSource: plan.fkGraphSource,
      fkEdges: snapshot.edges,
      phaseATruncateRoots: plan.phaseA.truncateRoots,
      phaseAClosure,
      tableCounts,
      serviceDeleteIds: deleteServices.map((s) => s.id),
      serviceKeepIds: seedServices.map((s) => s.id),
      serviceRequirementDeleteIds: requirementsOnDelete.map((r) => r.id),
      zoneDeleteIds: snapshot.zones.map((z) => z.id),
      authUserIds,
      storageObjects,
      executeOrder: [...executeOrder],
      blockingInputs: blocking.blockingInputs,
    });
  }

  return plan;
}

// Re-export for callers that imported fingerprintPlan from plan.mjs historically.
export { fingerprintPlan } from "./fingerprint.mjs";
