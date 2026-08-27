import { maskUserId } from "./qa-classification.mjs";
import { isProtectedSeededCatalogRow } from "./teardown-fk-plan.mjs";
import { collectBookingChildIds } from "./teardown-planner.mjs";
import { normalizePlanDeletions } from "./teardown-plan-normalize.mjs";
import {
  makeLocatorFromKeys,
  makeRootLocator,
  pushPlanDeletion,
} from "./teardown-row-locators.mjs";
import { executePlanDeletionSlice } from "./teardown-operations.mjs";
import {
  fingerprintStaleQaServicesPlan,
  STALE_QA_SERVICES_PLAN_VERSION,
} from "./stale-qa-services-fingerprint.mjs";

export const SERVICE_CHILD_LINK_TABLES = ["zone_services", "provider_services", "service_requirements"];

/**
 * Matches the SQL filter used to identify stale QA fixture services.
 * @param {{ name_en?: string | null; slug?: string | null; is_active?: boolean | null }} service
 */
export function matchesStaleQaServiceFilter(service) {
  if (service.is_active !== false) return false;
  const nameMatch = typeof service.name_en === "string" && service.name_en.toUpperCase().startsWith("QA ");
  const slugMatch = typeof service.slug === "string" && service.slug.toLowerCase().startsWith("qa-");
  return nameMatch || slugMatch;
}

export function maskProjectRef(projectRef) {
  if (!projectRef || projectRef.length < 12) return "****";
  return `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function discoverStaleInactiveQaServices(admin) {
  const [byName, bySlug] = await Promise.all([
    admin
      .from("services")
      .select("id,name_en,slug,is_active")
      .eq("is_active", false)
      .ilike("name_en", "QA %"),
    admin
      .from("services")
      .select("id,name_en,slug,is_active")
      .eq("is_active", false)
      .ilike("slug", "qa-%"),
  ]);
  if (byName.error) throw byName.error;
  if (bySlug.error) throw bySlug.error;

  /** @type {Map<string, { id: string; name_en: string; slug: string | null; is_active: boolean }>} */
  const byId = new Map();
  for (const row of [...(byName.data ?? []), ...(bySlug.data ?? [])]) {
    if (!matchesStaleQaServiceFilter(row)) continue;
    byId.set(row.id, row);
  }

  return [...byId.values()].sort((a, b) => (a.name_en ?? "").localeCompare(b.name_en ?? ""));
}

/**
 * @param {Array<{ table: string; phase: string; locator: import("./teardown-row-locators.mjs").RowLocator; resourceKey?: string }>} deletions
 * @param {string} resourceKey
 */
function countDependentRowsForService(deletions, resourceKey) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of deletions) {
    if (row.resourceKey !== resourceKey) continue;
    counts[row.table] = (counts[row.table] ?? 0) + row.locator.keys.length;
  }
  return counts;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ id: string; name_en: string; slug: string | null }} service
 * @param {Array<import("./teardown-planner.mjs").PlanRetained>} retained
 * @param {Array<import("./teardown-planner.mjs").PlanDeletion>} deletions
 */
async function planSingleStaleQaService(admin, service, retained, deletions) {
  const resourceKey = `services:${service.id}`;
  const scopeOwner = `service:${service.id}`;

  if (isProtectedSeededCatalogRow(service)) {
    retained.push({
      table: "services",
      id: service.id,
      reason: "protected-non-qa-name",
      phase: "qa_service",
      resourceKey,
    });
    return {
      id: service.id,
      name_en: service.name_en,
      slug: service.slug,
      maskedId: maskUserId(service.id),
      bookingCount: 0,
      deletableBookingCount: 0,
      retainedBookingCount: 0,
      deletable: false,
      retainReason: "protected-non-qa-name",
      dependentCounts: {},
    };
  }

  const { data: bookingRows, error: bookingError } = await admin
    .from("bookings")
    .select("id")
    .eq("service_id", service.id);
  if (bookingError) throw bookingError;
  const bookingIds = (bookingRows ?? []).map((row) => row.id);

  const deletionStart = deletions.length;
  deletions.push(...(await collectBookingChildIds(admin, bookingIds, scopeOwner, retained)));
  for (let index = deletionStart; index < deletions.length; index += 1) {
    deletions[index].resourceKey = resourceKey;
  }

  const retainedBookingIds = new Set(
    retained
      .filter((row) => row.table === "bookings" && row.ownerUserId === scopeOwner)
      .map((row) => row.id),
  );
  const deletableBookingIds = bookingIds.filter((id) => !retainedBookingIds.has(id));

  if (deletableBookingIds.length > 0) {
    pushPlanDeletion(deletions, {
      table: "bookings",
      locator: makeRootLocator("bookings", deletableBookingIds),
      ownerUserId: scopeOwner,
      phase: "booking",
      resourceKey,
    });
  }

  const serviceDeletable = retainedBookingIds.size === 0;
  /** @type {string | null} */
  let retainReason = null;
  if (!serviceDeletable) {
    retainReason = "immutable-booking-history-remaining";
    retained.push({
      table: "services",
      id: service.id,
      reason: retainReason,
      phase: "qa_service",
      resourceKey,
    });
  } else {
    for (const linkTable of SERVICE_CHILD_LINK_TABLES) {
      const { data: linkRows, error: linkError } = await admin
        .from(linkTable)
        .select("id")
        .eq("service_id", service.id);
      if (linkError) throw linkError;
      const locator = makeLocatorFromKeys(
        "single",
        ["id"],
        (linkRows ?? []).map((row) => ({ id: row.id })),
      );
      pushPlanDeletion(deletions, {
        table: linkTable,
        locator,
        phase: "qa_service_child",
        resourceKey,
      });
    }

    pushPlanDeletion(deletions, {
      table: "services",
      locator: makeRootLocator("services", [service.id]),
      phase: "qa_service",
      resourceKey,
    });
  }

  return {
    id: service.id,
    name_en: service.name_en,
    slug: service.slug,
    maskedId: maskUserId(service.id),
    bookingCount: bookingIds.length,
    deletableBookingCount: deletableBookingIds.length,
    retainedBookingCount: retainedBookingIds.size,
    deletable: serviceDeletable,
    retainReason,
    dependentCounts: countDependentRowsForService(deletions, resourceKey),
  };
}

/**
 * @param {Array<{ table: string; phase: string; locator: import("./teardown-row-locators.mjs").RowLocator; resourceKey?: string }>} deletions
 */
function summarizeDeletionCounts(deletions) {
  /** @type {Record<string, number>} */
  const byTable = {};
  for (const row of deletions) {
    byTable[row.table] = (byTable[row.table] ?? 0) + row.locator.keys.length;
  }
  return Object.entries(byTable)
    .map(([table, keyCount]) => ({ table, phase: "mixed", keyCount, resourceKey: null }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} projectRef
 */
export async function buildStaleQaServicesPlanFromAdmin(admin, projectRef) {
  const services = await discoverStaleInactiveQaServices(admin);
  /** @type {Array<import("./teardown-planner.mjs").PlanDeletion>} */
  const rawDeletions = [];
  /** @type {Array<import("./teardown-planner.mjs").PlanRetained>} */
  const retained = [];
  /** @type {Awaited<ReturnType<typeof planSingleStaleQaService>>[]} */
  const serviceSummaries = [];

  for (const service of services) {
    serviceSummaries.push(await planSingleStaleQaService(admin, service, retained, rawDeletions));
  }

  const deletions = normalizePlanDeletions(rawDeletions);
  const deletionSummary = summarizeDeletionCounts(deletions);
  const deletableServices = serviceSummaries.filter((row) => row.deletable).length;
  const retainedServices = serviceSummaries.filter((row) => !row.deletable).length;

  const fingerprint = fingerprintStaleQaServicesPlan({
    projectRef,
    services: serviceSummaries,
    deletions: deletionSummary,
    retained,
  });

  return {
    version: STALE_QA_SERVICES_PLAN_VERSION,
    projectRef,
    maskedProjectRef: maskProjectRef(projectRef),
    services: serviceSummaries,
    deletions,
    deletionSummary,
    retained,
    counts: {
      service_targets: services.length,
      deletable_services: deletableServices,
      retained_services: retainedServices,
      planned_deletions: deletions.reduce((sum, row) => sum + row.locator.keys.length, 0),
      planned_tables: deletionSummary.length,
    },
    fingerprint,
  };
}

/**
 * @param {Awaited<ReturnType<typeof buildStaleQaServicesPlanFromAdmin>>} plan
 */
export function sanitizeStaleQaServicesPlanForReport(plan) {
  return {
    version: plan.version,
    maskedProjectRef: plan.maskedProjectRef,
    counts: plan.counts,
    fingerprint: plan.fingerprint,
    services: plan.services.map((row) => ({
      maskedId: row.maskedId,
      name_en: row.name_en,
      slug: row.slug,
      bookingCount: row.bookingCount,
      deletableBookingCount: row.deletableBookingCount,
      retainedBookingCount: row.retainedBookingCount,
      deletable: row.deletable,
      retainReason: row.retainReason,
      dependentCounts: row.dependentCounts,
    })),
    deletionSummary: plan.deletionSummary,
    retained: plan.retained.map((row) => ({
      table: row.table,
      maskedId: maskUserId(row.id),
      reason: row.reason,
      phase: row.phase ?? null,
      resourceKey: row.resourceKey ?? null,
    })),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Awaited<ReturnType<typeof buildStaleQaServicesPlanFromAdmin>>} plan
 */
export async function executeStaleQaServicesPlan(admin, plan) {
  const result = await executePlanDeletionSlice(admin, plan.deletions);
  return {
    success: result.ok,
    errors: result.errors,
    deletedRowCount: plan.counts.planned_deletions,
  };
}
