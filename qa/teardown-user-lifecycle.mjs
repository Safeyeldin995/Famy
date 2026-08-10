import {
  attemptAuthHardDelete,
  deleteProfileRow,
  executeTerminalDisable,
  remainingIndicatesTerminalBlock,
} from "./teardown-terminal-disable.mjs";
import {
  executePlanDeletionSlice,
  isCoOwnedDeletion,
  isIdentityDeletion,
} from "./teardown-operations.mjs";
import { verifyUserFullyRemoved } from "./teardown-verification.mjs";
import { OUTCOME_LABELS, TERMINAL_DISABLE_OUTCOMES } from "./teardown-outcomes.mjs";
import { deletionOwnersIncludeUser } from "./teardown-plan-normalize.mjs";
import { isDestructiveCleanupEligible } from "./qa-classification.mjs";

/**
 * @param {Array<{ table: string; ownerUserId?: string }>} retained
 * @param {string} userId
 */
export function retainedTablesForUser(retained, userId) {
  return new Set(
    retained.filter((row) => row.ownerUserId === userId).map((row) => row.table),
  );
}

/**
 * @param {Array<{ table: string; phase: string; ownerUserId?: string; ownerUserIds?: string[]; coOwned?: boolean }>} deletions
 * @param {string} userId
 * @param {Set<string>} blockedTables
 * @param {{ coOwnedBlocked?: boolean }} [options]
 */
export function partitionUserDeletions(deletions, userId, blockedTables, options = {}) {
  const userRows = deletions.filter((row) =>
    deletionOwnersIncludeUser(userId, row.ownerUserIds, row.ownerUserId),
  );
  return {
    safe: userRows.filter(
      (row) =>
        !isIdentityDeletion(row)
        && !isCoOwnedDeletion(row)
        && !blockedTables.has(row.table)
        && !(options.coOwnedBlocked && ["booking_child", "booking"].includes(row.phase)),
    ),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function verifyTerminalDisabledStillEligible(admin, userId) {
  const [{ data: authData }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name,is_suspended").eq("id", userId).maybeSingle(),
  ]);
  const email = authData?.user?.email ?? null;
  const fullName = profile?.full_name ?? null;
  return isDestructiveCleanupEligible({ email, fullName, inRegistry: false });
}

/**
 * Run single-owner deletions and identity mutations without assigning final outcomes.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {{
 *   deletions: Array<{ table: string; locator: import("./teardown-row-locators.mjs").RowLocator; phase: string; ownerUserId?: string; ownerUserIds?: string[]; coOwned?: boolean }>;
 *   retained: Array<{ table: string; id: string; reason: string; ownerUserId?: string }>;
 *   coOwnedFailures?: Array<{ ownerUserIds: string[]; reason: string; errors?: unknown[] }>;
 *   coOwnedBlocked?: boolean;
 *   mutation: Awaited<ReturnType<typeof executeUserCleanupMutations>>;
 * }} ctx
 */
export async function executeUserCleanupMutations(admin, userId, ctx) {
  const blockedTables = retainedTablesForUser(ctx.retained, userId);
  const { safe } = partitionUserDeletions(ctx.deletions, userId, blockedTables, {
    coOwnedBlocked: ctx.coOwnedBlocked ?? false,
  });

  const safeSlice = await executePlanDeletionSlice(admin, safe);
  const authDelete = await attemptAuthHardDelete(admin, userId);
  let profileDelete = { ok: true, error: null };
  let terminal = null;

  if (authDelete.ok) {
    profileDelete = await deleteProfileRow(admin, userId);
  } else {
    const residueCheck = await verifyUserFullyRemoved(admin, userId);
    const blockers = residueCheck.remaining.filter(
      (label) => remainingIndicatesTerminalBlock([label]) || label.includes("ticket_messages") || label === "support_tickets" || label === "audit_logs(actor)",
    );

    if (blockers.length > 0 || residueCheck.terminalDisabled) {
      terminal = await executeTerminalDisable(admin, userId, {
        blockers: blockers.length ? blockers : residueCheck.remaining,
      });
    }
  }

  return {
    safeSlice,
    authDelete,
    profileDelete,
    terminal,
  };
}

/**
 * Authoritative final outcome after all shared and per-user mutations complete.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {{
 *   retained: Array<{ table: string; id: string; reason: string; ownerUserId?: string }>;
 *   coOwnedFailures?: Array<{ ownerUserIds: string[]; reason: string; errors?: unknown[] }>;
 *   mutation: Awaited<ReturnType<typeof executeUserCleanupMutations>>;
 * }} ctx
 */
export async function finalizeUserCleanupOutcome(admin, userId, ctx) {
  const verification = await verifyUserFullyRemoved(admin, userId);

  // Final live state is authoritative: transient slice errors do not force failure
  // when co-owned or later operations achieved complete cleanup.
  if (verification.removed && ctx.mutation.authDelete.ok && ctx.mutation.profileDelete.ok) {
    return { outcome: OUTCOME_LABELS.HARD_DELETED, reason: "fully-removed" };
  }

  const coOwnedFailure = !verification.removed
    ? ctx.coOwnedFailures?.find((row) => row.ownerUserIds.includes(userId))
    : undefined;

  if (ctx.mutation.terminal?.outcome === OUTCOME_LABELS.TERMINAL_DISABLED_VERIFIED) {
    const stillEligible = await verifyTerminalDisabledStillEligible(admin, userId);
    return {
      outcome: OUTCOME_LABELS.TERMINAL_DISABLED_VERIFIED,
      reason: ctx.mutation.terminal.reason,
      errors: ctx.mutation.terminal.errors ?? [],
      stillEligible,
      sessionVerified: true,
    };
  }

  if (ctx.mutation.terminal?.outcome === OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED) {
    const stillEligible = await verifyTerminalDisabledStillEligible(admin, userId);
    return {
      outcome: OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED,
      reason: ctx.mutation.terminal.reason,
      errors: ctx.mutation.terminal.errors ?? [],
      stillEligible,
      sessionVerified: false,
    };
  }

  if (ctx.mutation.terminal?.outcome === OUTCOME_LABELS.DISABLE_FAILED || (ctx.mutation.terminal && !ctx.mutation.terminal.ok)) {
    return {
      outcome: OUTCOME_LABELS.DISABLE_FAILED,
      reason: ctx.mutation.terminal.reason,
      errors: ctx.mutation.terminal.errors ?? [],
    };
  }

  if (ctx.mutation.terminal?.verified) {
    const stillEligible = await verifyTerminalDisabledStillEligible(admin, userId);
    return {
      outcome: OUTCOME_LABELS.TERMINAL_DISABLED,
      reason: ctx.mutation.terminal.reason,
      errors: ctx.mutation.terminal.errors ?? [],
      stillEligible,
    };
  }

  if (ctx.mutation.terminal && !ctx.mutation.terminal.verified && ctx.mutation.terminal.ok) {
    const stillEligible = await verifyTerminalDisabledStillEligible(admin, userId);
    return {
      outcome: OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED,
      reason: ctx.mutation.terminal.reason,
      errors: ctx.mutation.terminal.errors ?? [],
      stillEligible,
      sessionVerified: false,
    };
  }

  if (verification.terminalDisabled) {
    return {
      outcome: OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED,
      reason: `residue-terminal:${verification.remaining.join(",")}`,
      errors: ctx.mutation.terminal?.errors ?? [],
      sessionVerified: false,
    };
  }

  const reason = coOwnedFailure
    ? `co-owned-delete-failed:${coOwnedFailure.reason}`
    : !ctx.mutation.authDelete.ok
      ? `user-delete-failed:${verification.remaining.join(",") || "auth-delete-failed"}`
      : !ctx.mutation.profileDelete.ok
        ? "user-delete-failed:profiles"
        : !ctx.mutation.safeSlice.ok
          ? "user-delete-failed:safe-slice"
          : `residue-remaining:${verification.remaining.join(",")}`;

  return {
    outcome: OUTCOME_LABELS.FAILED,
    reason,
    errors: [
      ...(ctx.mutation.safeSlice.errors ?? []),
      ...(ctx.mutation.authDelete.error ? [ctx.mutation.authDelete.error] : []),
      ...(ctx.mutation.profileDelete.error ? [ctx.mutation.profileDelete.error] : []),
      ...(coOwnedFailure?.errors ?? []),
    ],
  };
}

/**
 * Backward-compatible wrapper used by older tests.
 */
export async function executeUserCleanupLifecycle(admin, userId, ctx) {
  const mutation = await executeUserCleanupMutations(admin, userId, ctx);
  return finalizeUserCleanupOutcome(admin, userId, {
    retained: ctx.retained,
    coOwnedFailures: ctx.coOwnedFailures ?? [],
    mutation,
  });
}
