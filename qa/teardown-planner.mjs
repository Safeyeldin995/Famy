import { createHash } from "node:crypto";
import { maskUserId } from "./qa-classification.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import {
  BOOKING_CHILD_DELETE_STEPS,
  PROVIDER_DELETE_STEPS,
  QA_TAGGED_RESOURCE_DEFS,
  USER_SCOPED_DELETE_STEPS,
  discoverOwnedBookingIds,
  isProtectedSeededCatalogRow,
  isQaTaggedName,
} from "./teardown-fk-plan.mjs";
import {
  canonicalizeLocator,
  discoverScopedLocatorKeys,
  makeLocatorFromKeys,
  makeRootLocator,
  pushPlanDeletion,
} from "./teardown-row-locators.mjs";
import {
  computeTableMetricBreakdown,
  countBookingMetrics,
  normalizePlanDeletions,
} from "./teardown-plan-normalize.mjs";
import { describeRetainedServiceTwoPass } from "./teardown-retained-services.mjs";
import { isImmutableTeardownTable } from "./teardown-immutable-contract.mjs";

export const CLEANUP_PLAN_VERSION = "6a.2-planner-v5";
export const REJECTED_PLAN_FINGERPRINT_V3 = "ef10ea3a2337d3d51b6a4191fd2cd09a3e1bc21b53ced8d75b203aeada8586da";

/**
 * @typedef {{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; ownerUserId?: string; ownerUserIds?: string[]; coOwned?: boolean; phase: string; resourceKey?: string }} PlanDeletion
 * @typedef {{ table: string; id: string; reason: string; phase?: string; ownerUserId?: string; resourceKey?: string }} PlanRetained
 * @typedef {{ userId: string; maskedId: string; reason?: string }} PlanUserEntry
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} bookingIds
 * @param {string} ownerUserId
 * @param {PlanRetained[]} retained
 */
async function collectBookingChildIds(admin, bookingIds, ownerUserId, retained) {
  /** @type {PlanDeletion[]} */
  const deletions = [];

  if (!bookingIds.length) return deletions;

  /** @type {Set<string>} */
  const bookingsWithImmutableHistory = new Set();

  const { data: cancellations, error: cancellationError } = await admin
    .from("booking_cancellations")
    .select("id,booking_id")
    .in("booking_id", bookingIds);
  if (cancellationError) throw cancellationError;
  for (const row of cancellations ?? []) {
    bookingsWithImmutableHistory.add(row.booking_id);
    retained.push({
      table: "booking_cancellations",
      id: row.id,
      ownerUserId,
      reason: "immutable-booking-cancellation",
      phase: "booking_child",
    });
  }

  const { data: auditRows, error: auditError } = await admin
    .from("audit_logs")
    .select("id,booking_id")
    .in("booking_id", bookingIds);
  if (auditError) throw auditError;
  for (const row of auditRows ?? []) {
    if (row.booking_id) {
      bookingsWithImmutableHistory.add(row.booking_id);
      retained.push({
        table: "audit_logs",
        id: row.id,
        ownerUserId,
        reason: "immutable-audit-log-block",
        phase: "booking_child",
      });
    }
  }

  const { data: conversations, error: conversationError } = await admin
    .from("conversations")
    .select("id,booking_id")
    .in("booking_id", bookingIds);
  if (conversationError) throw conversationError;

  /** @type {Set<string>} */
  const conversationsWithMessages = new Set();
  const conversationIds = (conversations ?? []).map((row) => row.id);
  if (conversationIds.length) {
    const { data: messageRows, error: messageError } = await admin
      .from("messages")
      .select("id,conversation_id")
      .in("conversation_id", conversationIds);
    if (messageError) throw messageError;
    for (const message of messageRows ?? []) {
      const conversation = (conversations ?? []).find((row) => row.id === message.conversation_id);
      if (!conversation) continue;
      bookingsWithImmutableHistory.add(conversation.booking_id);
      conversationsWithMessages.add(conversation.id);
      retained.push({
        table: "messages",
        id: message.id,
        ownerUserId,
        reason: "immutable-booking-message",
        phase: "booking_child",
      });
    }
  }

  for (const conversation of conversations ?? []) {
    if (conversationsWithMessages.has(conversation.id)) {
      retained.push({
        table: "conversations",
        id: conversation.id,
        ownerUserId,
        reason: "immutable-messages-block",
        phase: "booking_child",
      });
    }
  }

  for (const bookingId of bookingsWithImmutableHistory) {
    retained.push({
      table: "bookings",
      id: bookingId,
      ownerUserId,
      reason: "retained-immutable-history",
      phase: "booking",
    });
  }

  const deletableBookingIds = bookingIds.filter((id) => !bookingsWithImmutableHistory.has(id));

  for (const step of BOOKING_CHILD_DELETE_STEPS) {
    if (isImmutableTeardownTable(step.table)) continue;

    if (step.viaNotifications) {
      const { data: notifications, error } = await admin
        .from("notifications")
        .select("id")
        .in("booking_id", deletableBookingIds);
      if (error) throw error;
      const notificationIds = (notifications ?? []).map((row) => row.id);
      if (notificationIds.length) {
        const { data: outboxRows, error: outboxError } = await admin
          .from("notification_outbox")
          .select("id")
          .in("notification_id", notificationIds);
        if (outboxError) throw outboxError;
        const locator = makeLocatorFromKeys(
          "single",
          ["id"],
          (outboxRows ?? []).map((row) => ({ id: row.id })),
        );
        pushPlanDeletion(deletions, {
          table: "notification_outbox",
          locator,
          ownerUserId,
          phase: "booking_child",
        });
      }
      continue;
    }

    if (step.viaConversation) continue;

    if (step.table === "conversations") {
      const deletableConversationIds = (conversations ?? [])
        .filter((row) => deletableBookingIds.includes(row.booking_id) && !conversationsWithMessages.has(row.id))
        .map((row) => row.id);
      if (deletableConversationIds.length) {
        pushPlanDeletion(deletions, {
          table: "conversations",
          locator: makeRootLocator("conversations", deletableConversationIds),
          ownerUserId,
          phase: "booking_child",
        });
      }
      continue;
    }

    if (step.column) {
      const locator = await discoverScopedLocatorKeys(admin, step.table, step.column, deletableBookingIds);
      pushPlanDeletion(deletions, {
        table: step.table,
        locator,
        ownerUserId,
        phase: "booking_child",
      });
    }
  }

  return deletions;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} providerIds
 * @param {string} ownerUserId
 * @param {PlanRetained[]} retained
 */
async function collectProviderDependencyIds(admin, providerIds, ownerUserId, retained) {
  /** @type {PlanDeletion[]} */
  const deletions = [];
  if (!providerIds.length) return deletions;

  const retainedBookingIds = new Set(
    retained
      .filter((row) => row.table === "bookings" && row.reason === "retained-immutable-history")
      .map((row) => row.id),
  );

  /** @type {string[]} */
  const deletableProviderIds = [];
  for (const providerId of providerIds) {
    let retainProvider = false;
    if (retainedBookingIds.size > 0) {
      const { data: linkedBookings, error } = await admin
        .from("bookings")
        .select("id")
        .eq("provider_id", providerId)
        .in("id", [...retainedBookingIds]);
      if (error) throw error;
      retainProvider = (linkedBookings ?? []).length > 0;
    }

    if (retainProvider) {
      retained.push({
        table: "providers",
        id: providerId,
        ownerUserId,
        reason: "retained-immutable-history",
        phase: "provider",
      });
      continue;
    }
    deletableProviderIds.push(providerId);
  }

  for (const step of PROVIDER_DELETE_STEPS) {
    const locator = await discoverScopedLocatorKeys(admin, step.table, step.column, providerIds);
    pushPlanDeletion(deletions, {
      table: step.table,
      locator,
      ownerUserId,
      phase: "provider_child",
    });
  }

  if (deletableProviderIds.length) {
    pushPlanDeletion(deletions, {
      table: "providers",
      locator: makeRootLocator("providers", deletableProviderIds),
      ownerUserId,
      phase: "provider",
    });
  }

  return deletions;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {PlanRetained[]} retained
 */
async function collectUserScopedIds(admin, userId, retained) {
  /** @type {PlanDeletion[]} */
  const deletions = [];
  let immutableSupportHistory = false;

  for (const step of USER_SCOPED_DELETE_STEPS) {
    if (step.viaSupportTickets) {
      const { data: tickets, error } = await admin.from("support_tickets").select("id").eq("user_id", userId);
      if (error) throw error;
      const ticketIds = (tickets ?? []).map((row) => row.id);
      if (ticketIds.length) {
        const { data: messages, error: messageError } = await admin
          .from("ticket_messages")
          .select("id")
          .in("ticket_id", ticketIds);
        if (messageError) throw messageError;
        if ((messages ?? []).length > 0) {
          immutableSupportHistory = true;
          retained.push({
            table: "ticket_messages",
            id: userId,
            ownerUserId: userId,
            reason: "immutable-ticket-messages-block",
            phase: "user_scoped",
          });
          retained.push({
            table: "support_tickets",
            id: userId,
            ownerUserId: userId,
            reason: "immutable-ticket-messages-block",
            phase: "user_scoped",
          });
        }
      }
      continue;
    }

    if (step.table === "support_tickets" && immutableSupportHistory) {
      continue;
    }

    if (step.column) {
      const locator = await discoverScopedLocatorKeys(admin, step.table, step.column, [userId]);
      pushPlanDeletion(deletions, {
        table: step.table,
        locator,
        ownerUserId: userId,
        phase: "user_scoped",
      });
    }
  }

  pushPlanDeletion(deletions, {
    table: "profiles",
    locator: makeRootLocator("profiles", [userId]),
    ownerUserId: userId,
    phase: "user_identity_profile",
  });
  pushPlanDeletion(deletions, {
    table: "auth.users",
    locator: makeRootLocator("auth.users", [userId]),
    ownerUserId: userId,
    phase: "user_identity_auth",
  });

  return deletions;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {typeof QA_TAGGED_RESOURCE_DEFS[number]} def
 */
async function planQaTaggedResourceTable(admin, def) {
  /** @type {PlanDeletion[]} */
  const deletions = [];
  /** @type {PlanRetained[]} */
  const retained = [];

  const { data: rows, error } = await admin.from(def.table).select(`id,${def.column}`).ilike(def.column, "QA_%");
  if (error) throw error;

  for (const row of rows ?? []) {
    const tagValue = row[def.column];
    if (!isQaTaggedName(tagValue)) {
      retained.push({ table: def.table, id: row.id, reason: "protected-non-qa-tag", phase: "qa_resource" });
      continue;
    }

    /** @type {string | null} */
    let blockReason = null;
    for (const check of def.referenceChecks ?? []) {
      const { count, error: refError } = await admin
        .from(check.table)
        .select("id", { count: "exact", head: true })
        .eq(check.column, row.id);
      if (refError) throw refError;
      if ((count ?? 0) > 0) {
        blockReason = `${check.table}-reference-remaining`;
        break;
      }
    }

    if (blockReason) {
      retained.push({ table: def.table, id: row.id, reason: blockReason, phase: "qa_resource" });
      continue;
    }

    pushPlanDeletion(deletions, {
      table: def.table,
      locator: makeRootLocator(def.table, [row.id]),
      phase: "qa_resource",
      resourceKey: `${def.table}:${row.id}`,
    });
  }

  return { deletions, retained };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
async function planQaTaggedServices(admin) {
  /** @type {PlanDeletion[]} */
  const deletions = [];
  /** @type {PlanRetained[]} */
  const retained = [];

  const { data: services, error } = await admin.from("services").select("id,name_en,slug").ilike("name_en", "QA_%");
  if (error) throw error;

  for (const service of services ?? []) {
    if (isProtectedSeededCatalogRow(service)) {
      retained.push({ table: "services", id: service.id, reason: "protected-non-qa-name", phase: "qa_service" });
      continue;
    }
    const { count: bookingRefs, error: bookingError } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("service_id", service.id);
    if (bookingError) throw bookingError;
    if ((bookingRefs ?? 0) > 0) {
      retained.push({ table: "services", id: service.id, reason: "booking-reference-remaining", phase: "qa_service" });
      continue;
    }

    for (const linkTable of ["zone_services", "provider_services", "service_requirements"]) {
      const { data: linkRows, error: linkError } = await admin.from(linkTable).select("id").eq("service_id", service.id);
      if (linkError) throw linkError;
      const locator = makeLocatorFromKeys(
        "single",
        ["id"],
        (linkRows ?? []).map((row) => ({ id: row.id })),
      );
      pushPlanDeletion(deletions, { table: linkTable, locator, phase: "qa_service_child" });
    }

    pushPlanDeletion(deletions, {
      table: "services",
      locator: makeRootLocator("services", [service.id]),
      phase: "qa_service",
      resourceKey: `services:${service.id}`,
    });
  }

  return { deletions, retained };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
async function planQaTaggedZones(admin) {
  /** @type {PlanDeletion[]} */
  const deletions = [];
  /** @type {PlanRetained[]} */
  const retained = [];

  const { data: zones, error } = await admin.from("zones").select("id,name_en").ilike("name_en", "QA_%");
  if (error) throw error;

  for (const zone of zones ?? []) {
    if (!isQaTaggedName(zone.name_en)) {
      retained.push({ table: "zones", id: zone.id, reason: "protected-non-qa-name", phase: "qa_zone" });
      continue;
    }

    for (const linkTable of ["zone_providers", "zone_services"]) {
      const { data: linkRows, error: linkError } = await admin.from(linkTable).select("id").eq("zone_id", zone.id);
      if (linkError) throw linkError;
      const locator = makeLocatorFromKeys(
        "single",
        ["id"],
        (linkRows ?? []).map((row) => ({ id: row.id })),
      );
      pushPlanDeletion(deletions, { table: linkTable, locator, phase: "qa_zone_child" });
    }

    pushPlanDeletion(deletions, {
      table: "zones",
      locator: makeRootLocator("zones", [zone.id]),
      phase: "qa_zone",
      resourceKey: `zones:${zone.id}`,
    });
  }

  return { deletions, retained };
}

/**
 * @param {PlanDeletion[]} deletions
 */
function mergeDeletions(deletions) {
  /** @type {Map<string, Set<string>>} */
  const byTable = new Map();
  for (const row of deletions) {
    if (!byTable.has(row.table)) byTable.set(row.table, new Set());
    const bucket = byTable.get(row.table);
    for (const key of row.locator.keys) {
      bucket.add(JSON.stringify(key));
    }
  }
  return [...byTable.entries()].map(([table, keys]) => ({
    table,
    keyCount: keys.size,
  }));
}

/**
 * @param {Array<{ table: string; keyCount: number }>} merged
 */
function computeTableCounts(merged) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of merged) counts[row.table] = row.keyCount;
  return counts;
}

/**
 * @param {object} plan
 */
export function buildFingerprintPayload(plan) {
  const deletionKey = (row) => {
    const canon = canonicalizeLocator(row.locator);
    const owners = [...(row.ownerUserIds ?? (row.ownerUserId ? [row.ownerUserId] : []))].sort();
    return `${row.phase}:${row.table}:${owners.join(",")}:${row.resourceKey ?? ""}:${row.coOwned ? "co" : "single"}:${canon.kind}:${canon.columns.join(",")}:${JSON.stringify(canon.keys)}`;
  };

  const retainedKey = (row) =>
    `${row.phase ?? ""}:${row.table}:${row.id}:${row.ownerUserId ?? ""}:${row.resourceKey ?? ""}:${row.reason}`;

  return {
    version: plan.version,
    projectRef: plan.projectRef,
    eligibleUsers: plan.eligibleUsers.map((row) => row.userId).sort(),
    refusedUsers: plan.refusedUsers.map((row) => row.userId).sort(),
    deletions: [...plan.deletions]
      .map((row) => ({
        table: row.table,
        locator: canonicalizeLocator(row.locator),
        ownerUserIds: [...(row.ownerUserIds ?? (row.ownerUserId ? [row.ownerUserId] : []))].sort(),
        coOwned: row.coOwned ?? false,
        resourceKey: row.resourceKey ?? null,
        phase: row.phase,
      }))
      .sort((a, b) => deletionKey(a).localeCompare(deletionKey(b))),
    retained: [...plan.retained]
      .map((row) => ({
        table: row.table,
        id: row.id,
        reason: row.reason,
        ownerUserId: row.ownerUserId ?? null,
        resourceKey: row.resourceKey ?? null,
        phase: row.phase ?? null,
      }))
      .sort((a, b) => retainedKey(a).localeCompare(retainedKey(b))),
  };
}

/**
 * @param {object} plan
 */
export function computePlanFingerprint(plan) {
  const payload = buildFingerprintPayload(plan);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * @param {object} left
 * @param {object} right
 */
export function planFingerprintsMatch(left, right) {
  return computePlanFingerprint(left) === computePlanFingerprint(right);
}

/**
 * @param {object} plan
 */
export function summarizePlanCounts(plan) {
  const merged = mergeDeletions(plan.deletions);
  const tableCounts = computeTableCounts(merged);
  const tableMetrics = computeTableMetricBreakdown(plan.deletions);
  const bookingMetrics = countBookingMetrics(plan.deletions);
  const retainedServices = plan.retained.filter((row) => row.table === "services").length;

  return {
    eligible_users: plan.eligibleUsers.length,
    refused_users: plan.refusedUsers.length,
    unique_owned_bookings: bookingMetrics.uniqueOwnedBookings,
    booking_owner_attributions: bookingMetrics.bookingOwnerAttributions,
    owned_bookings: bookingMetrics.uniqueOwnedBookings,
    table_metrics: tableMetrics,
    booking_children: Object.fromEntries(
      Object.entries(tableCounts).filter(([table]) =>
        BOOKING_CHILD_DELETE_STEPS.some((step) => step.table === table || step.viaNotifications),
      ),
    ),
    provider_dependencies: Object.fromEntries(
      Object.entries(tableCounts).filter(([table]) =>
        PROVIDER_DELETE_STEPS.some((step) => step.table === table) || table === "providers",
      ),
    ),
    user_scoped: Object.fromEntries(
      Object.entries(tableCounts).filter(([table]) =>
        USER_SCOPED_DELETE_STEPS.some((step) => step.table === table || step.viaSupportTickets)
        || table === "profiles"
        || table === "auth.users"
        || table === "ticket_messages",
      ),
    ),
    qa_services: tableCounts.services ?? 0,
    qa_zones: tableCounts.zones ?? 0,
    qa_resources: Object.fromEntries(
      QA_TAGGED_RESOURCE_DEFS.map((def) => [def.table, tableCounts[def.table] ?? 0]),
    ),
    retained_rows: plan.retained.length,
    retained_services_two_pass: describeRetainedServiceTwoPass(retainedServices),
    tables: tableCounts,
  };
}

/**
 * @param {object} plan
 */
export function sanitizePlanForReport(plan) {
  const counts = summarizePlanCounts(plan);
  return {
    version: plan.version,
    projectRef: plan.projectRef,
    fingerprint: plan.fingerprint,
    counts,
    bookingSummary: {
      unique_owned_bookings: counts.unique_owned_bookings,
      booking_owner_attributions: counts.booking_owner_attributions,
    },
    retainedServicesTwoPass: counts.retained_services_two_pass,
    eligibleUsers: plan.eligibleUsers.map((row) => ({ maskedId: row.maskedId })),
    refusedUsers: plan.refusedUsers.map((row) => ({ maskedId: row.maskedId, reason: row.reason })),
    retained: plan.retained.map((row) => ({
      table: row.table,
      maskedId: maskUserId(row.id),
      reason: row.reason,
      phase: row.phase,
    })),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{
 *   candidateUserIds: string[];
 *   registryIds: Set<string>;
 *   assessEligibility: (admin: unknown, userId: string, registryIds: Set<string>) => Promise<{ eligible: boolean; reason: string }>;
 *   projectRef?: string;
 * }} params
 */
export async function buildCleanupPlan(params) {
  const { admin, candidateUserIds, registryIds, assessEligibility } = params;
  const projectRef = params.projectRef
    ?? (process.env.QA_SUPABASE_URL
      ? parseSupabaseProjectRef(process.env.QA_SUPABASE_URL)
      : "local-test");

  /** @type {PlanUserEntry[]} */
  const eligibleUsers = [];
  /** @type {PlanUserEntry[]} */
  const refusedUsers = [];
  /** @type {PlanDeletion[]} */
  const rawDeletions = [];
  /** @type {PlanRetained[]} */
  const retained = [];

  /** @type {Array<{ userId: string; providerIds: string[]; bookingIds: string[] }>} */
  const eligibleUserPlans = [];

  for (const userId of candidateUserIds) {
    const assessment = await assessEligibility(admin, userId, registryIds);
    if (!assessment.eligible) {
      refusedUsers.push({ userId, maskedId: maskUserId(userId), reason: assessment.reason });
      continue;
    }

    eligibleUsers.push({ userId, maskedId: maskUserId(userId) });

    const { data: providerRows, error: providerError } = await admin
      .from("providers")
      .select("id")
      .eq("profile_id", userId);
    if (providerError) throw providerError;
    const providerIds = (providerRows ?? []).map((row) => row.id);
    const bookingIds = await discoverOwnedBookingIds(admin, userId, providerIds);
    eligibleUserPlans.push({ userId, providerIds, bookingIds });
  }

  for (const userPlan of eligibleUserPlans) {
    rawDeletions.push(...await collectBookingChildIds(admin, userPlan.bookingIds, userPlan.userId, retained));
    const retainedBookingIds = new Set(
      retained
        .filter((row) => row.table === "bookings" && row.ownerUserId === userPlan.userId)
        .map((row) => row.id),
    );
    const deletableBookingIds = userPlan.bookingIds.filter((id) => !retainedBookingIds.has(id));
    if (deletableBookingIds.length) {
      pushPlanDeletion(rawDeletions, {
        table: "bookings",
        locator: makeRootLocator("bookings", deletableBookingIds),
        ownerUserId: userPlan.userId,
        phase: "booking",
      });
    }
    rawDeletions.push(...await collectProviderDependencyIds(admin, userPlan.providerIds, userPlan.userId, retained));
    rawDeletions.push(...await collectUserScopedIds(admin, userPlan.userId, retained));
  }

  for (const def of QA_TAGGED_RESOURCE_DEFS) {
    const resourcePlan = await planQaTaggedResourceTable(admin, def);
    rawDeletions.push(...resourcePlan.deletions);
    retained.push(...resourcePlan.retained);
  }

  const servicePlan = await planQaTaggedServices(admin);
  rawDeletions.push(...servicePlan.deletions);
  retained.push(...servicePlan.retained);

  const zonePlan = await planQaTaggedZones(admin);
  rawDeletions.push(...zonePlan.deletions);
  retained.push(...zonePlan.retained);

  const deletions = normalizePlanDeletions(rawDeletions);

  /** @type {object} */
  const plan = {
    version: CLEANUP_PLAN_VERSION,
    projectRef,
    eligibleUsers,
    refusedUsers,
    deletions,
    retained,
  };

  plan.fingerprint = computePlanFingerprint(plan);
  plan.counts = summarizePlanCounts(plan);
  return plan;
}

/**
 * @param {object} plan
 * @param {string | undefined} expectedFingerprint
 */
export function assertExecutePlanApproved(plan, expectedFingerprint) {
  if (!expectedFingerprint) {
    throw new Error(
      "Destructive cleanup requires --plan-fingerprint from the preceding dry-run.",
    );
  }
  if (expectedFingerprint === REJECTED_PLAN_FINGERPRINT_V3) {
    throw new Error(
      "[qa-cleanup] Rejected planner fingerprint refused — rebuild dry-run with planner v4 normalization.",
    );
  }
  if (plan.fingerprint !== expectedFingerprint) {
    throw new Error(
      `[qa-cleanup] Plan fingerprint mismatch — execute refused. dry-run=${expectedFingerprint} current=${plan.fingerprint}`,
    );
  }
}
