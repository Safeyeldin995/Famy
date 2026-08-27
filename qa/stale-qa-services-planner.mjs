import { maskUserId } from "./qa-classification.mjs";
import { BOOKING_CHILD_DELETE_STEPS, isProtectedSeededCatalogRow } from "./teardown-fk-plan.mjs";
import { collectBookingChildIds } from "./teardown-planner.mjs";
import { normalizePlanDeletions } from "./teardown-plan-normalize.mjs";
import { formatTeardownError, logTeardownError } from "./teardown-errors.mjs";
import {
  discoverScopedLocatorKeys,
  executeLocatorDeletion,
  makeLocatorFromKeys,
  makeRootLocator,
  pushPlanDeletion,
} from "./teardown-row-locators.mjs";
import {
  fingerprintStaleQaServicesPlan,
  STALE_QA_SERVICES_PLAN_VERSION,
} from "./stale-qa-services-fingerprint.mjs";

export const SERVICE_CHILD_LINK_TABLES = ["zone_services", "provider_services", "service_requirements"];
export const IMMUTABLE_HISTORY_OVERRIDE_PHASE = "immutable_history_override";

const STALE_SERVICES_EXECUTE_PHASE_ORDER = {
  [IMMUTABLE_HISTORY_OVERRIDE_PHASE]: 5,
  booking_child: 10,
  booking: 20,
  qa_service_child: 70,
  qa_service: 80,
};

/** @typedef {{ overrideImmutableHistory?: boolean }} StaleQaServicesPlanOptions */

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
 * Stale-services-only override: plan deletion of immutable booking history blockers.
 * Does not modify shared teardown helpers.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} bookingIds
 * @param {string} resourceKey
 * @param {string} scopeOwner
 * @param {Array<import("./teardown-planner.mjs").PlanDeletion>} deletions
 */
async function planImmutableHistoryOverrideDeletions(
  admin,
  bookingIds,
  resourceKey,
  scopeOwner,
  deletions,
) {
  /** @type {{ audit_logs: number; booking_cancellations: number; messages: number; conversations: number }} */
  const counts = {
    audit_logs: 0,
    booking_cancellations: 0,
    messages: 0,
    conversations: 0,
  };

  if (!bookingIds.length) return counts;

  const { data: cancellations, error: cancellationError } = await admin
    .from("booking_cancellations")
    .select("id")
    .in("booking_id", bookingIds);
  if (cancellationError) throw cancellationError;
  if ((cancellations ?? []).length > 0) {
    counts.booking_cancellations = cancellations.length;
    pushPlanDeletion(deletions, {
      table: "booking_cancellations",
      locator: makeLocatorFromKeys(
        "single",
        ["id"],
        cancellations.map((row) => ({ id: row.id })),
      ),
      ownerUserId: scopeOwner,
      phase: IMMUTABLE_HISTORY_OVERRIDE_PHASE,
      resourceKey,
    });
  }

  const { data: auditRows, error: auditError } = await admin
    .from("audit_logs")
    .select("id")
    .in("booking_id", bookingIds);
  if (auditError) throw auditError;
  if ((auditRows ?? []).length > 0) {
    counts.audit_logs = auditRows.length;
    pushPlanDeletion(deletions, {
      table: "audit_logs",
      locator: makeLocatorFromKeys(
        "single",
        ["id"],
        auditRows.map((row) => ({ id: row.id })),
      ),
      ownerUserId: scopeOwner,
      phase: IMMUTABLE_HISTORY_OVERRIDE_PHASE,
      resourceKey,
    });
  }

  const { data: conversations, error: conversationError } = await admin
    .from("conversations")
    .select("id")
    .in("booking_id", bookingIds);
  if (conversationError) throw conversationError;
  const conversationIds = (conversations ?? []).map((row) => row.id);

  if (conversationIds.length > 0) {
    const { data: messageRows, error: messageError } = await admin
      .from("messages")
      .select("id")
      .in("conversation_id", conversationIds);
    if (messageError) throw messageError;
    if ((messageRows ?? []).length > 0) {
      counts.messages = messageRows.length;
      pushPlanDeletion(deletions, {
        table: "messages",
        locator: makeLocatorFromKeys(
          "single",
          ["id"],
          messageRows.map((row) => ({ id: row.id })),
        ),
        ownerUserId: scopeOwner,
        phase: IMMUTABLE_HISTORY_OVERRIDE_PHASE,
        resourceKey,
      });
    }

    counts.conversations = conversations.length;
    pushPlanDeletion(deletions, {
      table: "conversations",
      locator: makeRootLocator("conversations", conversationIds),
      ownerUserId: scopeOwner,
      phase: IMMUTABLE_HISTORY_OVERRIDE_PHASE,
      resourceKey,
    });
  }

  return counts;
}

/**
 * Stale-services-only booking child planning for fully unblocked bookings.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} bookingIds
 * @param {string} resourceKey
 * @param {string} scopeOwner
 * @param {Array<import("./teardown-planner.mjs").PlanDeletion>} deletions
 */
async function planStandardBookingChildrenForIds(admin, bookingIds, resourceKey, scopeOwner, deletions) {
  if (!bookingIds.length) return;

  for (const step of BOOKING_CHILD_DELETE_STEPS) {
    if (
      step.table === "booking_cancellations" ||
      step.table === "audit_logs" ||
      step.table === "messages" ||
      step.table === "conversations"
    ) {
      continue;
    }

    if (step.viaNotifications) {
      const { data: notifications, error } = await admin
        .from("notifications")
        .select("id")
        .in("booking_id", bookingIds);
      if (error) throw error;
      const notificationIds = (notifications ?? []).map((row) => row.id);
      if (notificationIds.length > 0) {
        const { data: outboxRows, error: outboxError } = await admin
          .from("notification_outbox")
          .select("id")
          .in("notification_id", notificationIds);
        if (outboxError) throw outboxError;
        pushPlanDeletion(deletions, {
          table: "notification_outbox",
          locator: makeLocatorFromKeys(
            "single",
            ["id"],
            (outboxRows ?? []).map((row) => ({ id: row.id })),
          ),
          ownerUserId: scopeOwner,
          phase: "booking_child",
          resourceKey,
        });
      }
      continue;
    }

    if (step.viaConversation) continue;

    if (step.column) {
      const locator = await discoverScopedLocatorKeys(admin, step.table, step.column, bookingIds);
      pushPlanDeletion(deletions, {
        table: step.table,
        locator,
        ownerUserId: scopeOwner,
        phase: "booking_child",
        resourceKey,
      });
    }
  }
}

function planServiceChildrenAndRow(admin, service, resourceKey, deletions) {
  return Promise.all(
    SERVICE_CHILD_LINK_TABLES.map(async (linkTable) => {
      const { data: linkRows, error: linkError } = await admin
        .from(linkTable)
        .select("id")
        .eq("service_id", service.id);
      if (linkError) throw linkError;
      pushPlanDeletion(deletions, {
        table: linkTable,
        locator: makeLocatorFromKeys(
          "single",
          ["id"],
          (linkRows ?? []).map((row) => ({ id: row.id })),
        ),
        phase: "qa_service_child",
        resourceKey,
      });
    }),
  ).then(() => {
    pushPlanDeletion(deletions, {
      table: "services",
      locator: makeRootLocator("services", [service.id]),
      phase: "qa_service",
      resourceKey,
    });
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ id: string; name_en: string; slug: string | null }} service
 * @param {Array<import("./teardown-planner.mjs").PlanRetained>} retained
 * @param {Array<import("./teardown-planner.mjs").PlanDeletion>} deletions
 * @param {StaleQaServicesPlanOptions} [options]
 */
async function planSingleStaleQaService(admin, service, retained, deletions, options = {}) {
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
      immutableOverrideCounts: {
        audit_logs: 0,
        booking_cancellations: 0,
        messages: 0,
        conversations: 0,
      },
    };
  }

  const { data: bookingRows, error: bookingError } = await admin
    .from("bookings")
    .select("id")
    .eq("service_id", service.id);
  if (bookingError) throw bookingError;
  const bookingIds = (bookingRows ?? []).map((row) => row.id);

  /** @type {{ audit_logs: number; booking_cancellations: number; messages: number; conversations: number }} */
  const immutableOverrideCounts = {
    audit_logs: 0,
    booking_cancellations: 0,
    messages: 0,
    conversations: 0,
  };

  if (options.overrideImmutableHistory) {
    const overrideCounts = await planImmutableHistoryOverrideDeletions(
      admin,
      bookingIds,
      resourceKey,
      scopeOwner,
      deletions,
    );
    immutableOverrideCounts.audit_logs += overrideCounts.audit_logs;
    immutableOverrideCounts.booking_cancellations += overrideCounts.booking_cancellations;
    immutableOverrideCounts.messages += overrideCounts.messages;
    immutableOverrideCounts.conversations += overrideCounts.conversations;

    await planStandardBookingChildrenForIds(admin, bookingIds, resourceKey, scopeOwner, deletions);

    if (bookingIds.length > 0) {
      pushPlanDeletion(deletions, {
        table: "bookings",
        locator: makeRootLocator("bookings", bookingIds),
        ownerUserId: scopeOwner,
        phase: "booking",
        resourceKey,
      });
    }

    await planServiceChildrenAndRow(admin, service, resourceKey, deletions);

    return {
      id: service.id,
      name_en: service.name_en,
      slug: service.slug,
      maskedId: maskUserId(service.id),
      bookingCount: bookingIds.length,
      deletableBookingCount: bookingIds.length,
      retainedBookingCount: 0,
      deletable: true,
      retainReason: null,
      dependentCounts: countDependentRowsForService(deletions, resourceKey),
      immutableOverrideCounts,
    };
  }

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
    await planServiceChildrenAndRow(admin, service, resourceKey, deletions);
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
    immutableOverrideCounts,
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
 * @param {StaleQaServicesPlanOptions} [options]
 */
export async function buildStaleQaServicesPlanFromAdmin(admin, projectRef, options = {}) {
  const services = await discoverStaleInactiveQaServices(admin);
  /** @type {Array<import("./teardown-planner.mjs").PlanDeletion>} */
  const rawDeletions = [];
  /** @type {Array<import("./teardown-planner.mjs").PlanRetained>} */
  const retained = [];
  /** @type {Awaited<ReturnType<typeof planSingleStaleQaService>>[]} */
  const serviceSummaries = [];
  /** @type {{ audit_logs: number; booking_cancellations: number; messages: number; conversations: number }} */
  const immutableOverrideTotals = {
    audit_logs: 0,
    booking_cancellations: 0,
    messages: 0,
    conversations: 0,
  };

  for (const service of services) {
    const summary = await planSingleStaleQaService(admin, service, retained, rawDeletions, options);
    serviceSummaries.push(summary);
    immutableOverrideTotals.audit_logs += summary.immutableOverrideCounts.audit_logs;
    immutableOverrideTotals.booking_cancellations += summary.immutableOverrideCounts.booking_cancellations;
    immutableOverrideTotals.messages += summary.immutableOverrideCounts.messages;
    immutableOverrideTotals.conversations += summary.immutableOverrideCounts.conversations;
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
    overrideImmutableHistory: options.overrideImmutableHistory ?? false,
    immutableOverrideCounts: immutableOverrideTotals,
  });

  return {
    version: STALE_QA_SERVICES_PLAN_VERSION,
    projectRef,
    maskedProjectRef: maskProjectRef(projectRef),
    overrideImmutableHistory: options.overrideImmutableHistory ?? false,
    immutableOverrideCounts: immutableOverrideTotals,
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
    overrideImmutableHistory: plan.overrideImmutableHistory,
    immutableOverrideCounts: plan.immutableOverrideCounts,
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
 * @param {Array<{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; phase: string }>} deletions
 */
function sortStaleServicesDeletions(deletions) {
  return [...deletions].sort(
    (a, b) =>
      (STALE_SERVICES_EXECUTE_PHASE_ORDER[a.phase] ?? 999) -
      (STALE_SERVICES_EXECUTE_PHASE_ORDER[b.phase] ?? 999),
  );
}

/**
 * Stale-services-only executor for immutable override rows (bypasses shared immutable guard).
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} table
 * @param {import("./teardown-row-locators.mjs").RowLocator} locator
 * @param {Array<ReturnType<typeof formatTeardownError>>} errors
 */
async function executeImmutableOverrideDeletion(admin, table, locator, errors) {
  for (const key of locator.keys) {
    let query = admin.from(table).delete();
    for (const column of locator.columns) {
      query = query.eq(column, key[column]);
    }
    const { error } = await query;
    if (error) {
      const entry = formatTeardownError({
        operation: "delete",
        table,
        id: Object.values(key).join(":"),
        error,
      });
      errors.push(entry);
      logTeardownError(entry);
    }
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Awaited<ReturnType<typeof buildStaleQaServicesPlanFromAdmin>>} plan
 */
export async function executeStaleQaServicesPlan(admin, plan) {
  /** @type {Array<ReturnType<typeof formatTeardownError>>} */
  const errors = [];

  for (const row of sortStaleServicesDeletions(plan.deletions)) {
    if (row.phase === IMMUTABLE_HISTORY_OVERRIDE_PHASE) {
      await executeImmutableOverrideDeletion(admin, row.table, row.locator, errors);
      continue;
    }
    await executeLocatorDeletion(admin, row.table, row.locator, errors);
  }

  return {
    success: errors.length === 0,
    errors,
    deletedRowCount: plan.counts.planned_deletions,
  };
}
