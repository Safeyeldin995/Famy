import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  CATALOG_KEEP_TABLES,
  PHASE_A_TRUNCATE_ROOTS,
  PLAN_VERSION,
  STORAGE_BUCKETS,
} from "./constants.mjs";
import { loadPublicFkEdges } from "./fk-graph.mjs";
import {
  computeServiceDeleteCascadeTables,
  computeTruncateCascadeClosure,
} from "./fk-closure.mjs";
import {
  fingerprintSortedIds,
  isQaFixtureName,
  SEED_SERVICE_SLUG_SET,
} from "./seed-catalog.mjs";
import { maskProjectRef } from "./load-production-env.mjs";
import { inventoryStorageBuckets, classifyStorageObject } from "./storage-inventory.mjs";
import {
  AUDIT_TRIGGER_TABLES,
  NO_AUDIT_TRIGGER_TARGETS,
  PHASE_B_AUDIT_WRITERS,
} from "./audit-triggers-catalog.mjs";

const USER_ROW_TABLES = [
  "audit_logs",
  "booking_cancellations",
  "booking_family_member_snapshots",
  "booking_locations",
  "booking_message_reads",
  "booking_reminders",
  "booking_requirement_selections",
  "booking_reschedule_requests",
  "booking_status_history",
  "bookings",
  "conversations",
  "coupon_redemptions",
  "disputes",
  "family_members",
  "favorites",
  "messages",
  "no_show_reports",
  "notification_campaigns",
  "notification_outbox",
  "notifications",
  "notification_preferences",
  "otp_verifications",
  "password_setup_authorizations",
  "payments",
  "profiles",
  "promo_code_redemptions",
  "provider_admin_internal_notes",
  "provider_documents",
  "provider_incidents",
  "provider_onboarding_details",
  "provider_onboarding_events",
  "provider_references",
  "provider_requirement_fulfillments",
  "provider_services",
  "provider_vacations",
  "providers",
  "push_subscriptions",
  "ratings_summary",
  "reviews",
  "support_tickets",
  "ticket_messages",
  "transactions",
  "trust_scores",
  "user_roles",
  "verification_records",
  "zone_providers",
  "addresses",
  "availability_exceptions",
  "availability_rules",
];

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
async function countAuthUsers(admin) {
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    total += data.users.length;
    if (data.users.length < 200) break;
  }
  return total;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
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

/**
 * @param {object} plan
 */
export function fingerprintPlan(plan) {
  const canonical = JSON.stringify({
    version: plan.version,
    phaseAClosure: plan.phaseA.truncateCascadeClosure,
    serviceDeleteFingerprint: plan.phaseB.serviceDeleteFingerprint,
    zoneDeleteFingerprint: plan.phaseB.zoneDeleteFingerprint,
    rowCounts: plan.counts,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * @param {{ url: string; serviceRoleKey: string; projectRef: string }} env
 */
export async function buildProductionResetPlan(env) {
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { edges, source: fkSource } = loadPublicFkEdges();
  const phaseAClosure = computeTruncateCascadeClosure(edges, [...PHASE_A_TRUNCATE_ROOTS]);
  const phaseBServiceCascadeTables = computeServiceDeleteCascadeTables(edges);

  const catalogInClosure = phaseAClosure.filter((t) => CATALOG_KEEP_TABLES.has(t));

  const services = await fetchAllRows(admin, "services", "id, slug, name_en");
  const seedServices = services.filter((s) => SEED_SERVICE_SLUG_SET.has(s.slug));
  const deleteServices = services.filter((s) => !SEED_SERVICE_SLUG_SET.has(s.slug));

  const zones = await fetchAllRows(admin, "zones", "id, name_en");
  const qaZones = zones.filter((z) => isQaFixtureName(z.name_en));

  const requirements = await fetchAllRows(admin, "service_requirements", "id, service_id");
  const deleteServiceIds = new Set(deleteServices.map((s) => s.id));
  const requirementsOnDelete = requirements.filter((r) => deleteServiceIds.has(r.service_id));

  const tableCounts = {};
  let userRowSum = 0;
  for (const t of USER_ROW_TABLES) {
    const c = await countTable(admin, t);
    tableCounts[t] = c;
    userRowSum += c;
  }

  const authUsers = await countAuthUsers(admin);

  const profiles = await fetchAllRows(admin, "profiles", "id");
  const profileIds = new Set(profiles.map((p) => p.id));
  const providers = await fetchAllRows(admin, "providers", "id");
  const providerIds = new Set(providers.map((p) => p.id));
  const bookings = await fetchAllRows(admin, "bookings", "id");
  const bookingIds = new Set(bookings.map((b) => b.id));

  const storage = await inventoryStorageBuckets(admin, STORAGE_BUCKETS);
  let storageTotal = 0;
  const storageByClass = {};
  for (const bucket of STORAGE_BUCKETS) {
    for (const obj of storage[bucket].keys) {
      storageTotal++;
      const cls = classifyStorageObject(bucket, obj.key, profileIds, providerIds, bookingIds);
      storageByClass[cls] = (storageByClass[cls] ?? 0) + 1;
    }
  }

  // Avatar auth-only check: folders with no profile but live auth.users
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
  const plan = {
    version: PLAN_VERSION,
    maskedProjectRef: maskProjectRef(env.projectRef),
    fkGraphSource: fkSource,
    blocked: catalogInClosure.length > 0,
    blockedReason:
      catalogInClosure.length > 0
        ? `Phase A closure includes catalog tables: ${catalogInClosure.join(", ")}`
        : null,
    phaseA: {
      truncateRoots: [...PHASE_A_TRUNCATE_ROOTS],
      truncateCascadeClosure: phaseAClosure,
      truncateCascadeClosureCount: phaseAClosure.length,
    },
    phaseB: {
      serviceDeleteCount: deleteServices.length,
      serviceKeepCount: seedServices.length,
      serviceDeleteFingerprint: fingerprintSortedIds(deleteServices.map((s) => s.id)),
      serviceKeepFingerprint: fingerprintSortedIds(seedServices.map((s) => s.id)),
      zoneDeleteCount: zones.length,
      zoneQaShapedCount: qaZones.length,
      zoneDeleteFingerprint: fingerprintSortedIds(zones.map((z) => z.id)),
      serviceRequirementDeleteCount: requirementsOnDelete.length,
      serviceDeleteCascadeTables: phaseBServiceCascadeTables,
      auditWriters: PHASE_B_AUDIT_WRITERS,
    },
    phaseC: {
      authUsersDeleteCount: authUsers,
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
    executeOrder: [
      "Phase A: TRUNCATE phaseA.truncateRoots CASCADE (closure tables)",
      "Phase B: DELETE 461 fingerprinted non-seed services (fires trg_audit_services)",
      "Phase B2: TRUNCATE audit_logs (post-service-delete, pre-auth)",
      "Phase C: DELETE all auth.users via Auth Admin API",
      "Phase D: TRUNCATE audit_logs (final safety-net verify/clear)",
      "Phase E: DELETE all storage objects in four buckets",
    ],
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
      authUsers: authUsers,
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
  };

  plan.fingerprint = fingerprintPlan(plan);
  return plan;
}

/**
 * @param {Awaited<ReturnType<typeof buildProductionResetPlan>>} plan
 */
export function sanitizePlanForReport(plan) {
  return plan;
}
