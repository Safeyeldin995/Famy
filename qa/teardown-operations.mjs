import { formatTeardownError, logTeardownError } from "./teardown-errors.mjs";
import {
  BOOKING_CHILD_DELETE_STEPS,
  PROVIDER_DELETE_STEPS,
  USER_SCOPED_DELETE_STEPS,
  discoverOwnedBookingIds,
  isQaTaggedName,
} from "./teardown-fk-plan.mjs";
import { executeLocatorDeletion } from "./teardown-row-locators.mjs";
import { verifyUserFullyRemoved } from "./teardown-verification.mjs";

const EXECUTE_PHASE_ORDER = {
  booking_child: 10,
  booking: 20,
  provider_child: 30,
  provider: 40,
  user_scoped: 55,
  user_identity_profile: 60,
  user_identity_auth: 61,
  qa_service_child: 70,
  qa_service: 80,
  qa_zone_child: 90,
  qa_zone: 100,
  qa_resource: 110,
};

const RESOURCE_PHASES = new Set([
  "qa_service_child",
  "qa_service",
  "qa_zone_child",
  "qa_zone",
  "qa_resource",
]);

const IDENTITY_PHASES = new Set(["user_identity_profile", "user_identity_auth"]);

/**
 * @param {{ phase: string }} row
 */
export function isIdentityDeletion(row) {
  return IDENTITY_PHASES.has(row.phase);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} table
 * @param {string} column
 * @param {string} value
 * @param {Array<ReturnType<typeof formatTeardownError>>} errors
 */
async function deleteWhere(admin, table, column, value, errors) {
  const { error } = await admin.from(table).delete().eq(column, value);
  if (error) {
    const entry = formatTeardownError({
      operation: "delete",
      table,
      id: value,
      error,
    });
    errors.push(entry);
    logTeardownError(entry);
    return false;
  }
  return true;
}

/**
 * @param {Array<{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; phase: string; ownerUserId?: string; resourceKey?: string }>} deletions
 */
export function sortPlanDeletions(deletions) {
  return [...deletions].sort(
    (a, b) => (EXECUTE_PHASE_ORDER[a.phase] ?? 999) - (EXECUTE_PHASE_ORDER[b.phase] ?? 999),
  );
}

/**
 * Execute one deletion slice; failures are local to this slice only.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Array<{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; phase: string }>} deletions
 */
export async function executePlanDeletionSlice(admin, deletions) {
  /** @type {Array<ReturnType<typeof formatTeardownError>>} */
  const errors = [];

  for (const row of sortPlanDeletions(deletions)) {
    if (row.table === "auth.users" || row.table === "profiles") {
      continue;
    }

    await executeLocatorDeletion(admin, row.table, row.locator, errors);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ coOwned?: boolean; phase: string }} row
 */
export function isCoOwnedDeletion(row) {
  return row.coOwned === true;
}

/**
 * @param {{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; phase: string; ownerUserId?: string; ownerUserIds?: string[]; resourceKey?: string; coOwned?: boolean }} row
 */
export function isSharedResourceDeletion(row) {
  return !row.ownerUserId && !(row.ownerUserIds?.length) && RESOURCE_PHASES.has(row.phase);
}

/**
 * FK-safe booking child deletion. audit_logs are intentionally not deleted.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} bookingId
 */
export async function deleteBookingChildren(admin, bookingId) {
  /** @type {Array<ReturnType<typeof formatTeardownError>>} */
  const errors = [];

  for (const step of BOOKING_CHILD_DELETE_STEPS) {
    if (step.viaNotifications) {
      const { data: notificationRows, error: selectError } = await admin
        .from("notifications")
        .select("id")
        .eq("booking_id", bookingId);
      if (selectError) {
        errors.push(formatTeardownError({ operation: "select", table: "notifications", id: bookingId, error: selectError }));
        continue;
      }
      const notificationIds = (notificationRows ?? []).map((row) => row.id);
      if (notificationIds.length > 0) {
        const { error } = await admin.from("notification_outbox").delete().in("notification_id", notificationIds);
        if (error) {
          errors.push(formatTeardownError({ operation: "delete", table: "notification_outbox", id: bookingId, error }));
          logTeardownError(errors[errors.length - 1]);
        }
      }
      continue;
    }

    if (step.viaConversation) {
      const { data: conversations, error: convError } = await admin
        .from("conversations")
        .select("id")
        .eq("booking_id", bookingId);
      if (convError) {
        errors.push(formatTeardownError({ operation: "select", table: "conversations", id: bookingId, error: convError }));
        continue;
      }
      for (const conv of conversations ?? []) {
        await deleteWhere(admin, "messages", "conversation_id", conv.id, errors);
      }
      continue;
    }

    if (step.column) {
      await deleteWhere(admin, step.table, step.column, bookingId, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} providerId
 */
export async function deleteProviderDeep(admin, providerId) {
  /** @type {Array<ReturnType<typeof formatTeardownError>>} */
  const errors = [];

  for (const step of PROVIDER_DELETE_STEPS) {
    if (step.table === "ratings_summary" || step.table === "trust_scores") {
      await deleteWhere(admin, step.table, "provider_id", providerId, errors);
    } else {
      await deleteWhere(admin, step.table, step.column, providerId, errors);
    }
  }

  const { error } = await admin.from("providers").delete().eq("id", providerId);
  if (error) {
    const entry = formatTeardownError({ operation: "delete", table: "providers", id: providerId, error });
    errors.push(entry);
    logTeardownError(entry);
  }

  return { ok: errors.length === 0, errors };
}

export { discoverOwnedBookingIds, isQaTaggedName, verifyUserFullyRemoved };
