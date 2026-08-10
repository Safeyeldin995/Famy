/**
 * Honest residue metrics — immutable history is not active operational residue.
 */

/** @typedef {{
 *   active_operational_residue: number;
 *   retained_immutable_history: number;
 *   terminal_disabled_identities: number;
 *   deletable_QA_resources: number;
 *   protected_seed_data: number;
 * }} HonestResidueMetrics */

const IMMUTABLE_RETAIN_REASONS = new Set([
  "immutable-booking-cancellation",
  "immutable-booking-message",
  "immutable-messages-block",
  "retained-immutable-history",
  "immutable-ticket-messages-block",
  "immutable-audit-log-block",
]);

/**
 * @param {Array<{ table: string; reason: string; ownerUserId?: string }>} retained
 */
export function countRetainedImmutableHistory(retained) {
  return retained.filter((row) =>
    IMMUTABLE_RETAIN_REASONS.has(row.reason)
    || row.table === "booking_cancellations"
    || row.table === "messages"
    || row.table === "ticket_messages"
    || row.table === "audit_logs"
    || (row.table === "providers" && row.reason === "retained-immutable-history"),
  ).length;
}

/**
 * @param {{
 *   plan: { retained: Array<{ table: string; reason: string }>; counts?: Record<string, unknown> };
 *   outcomes?: Map<string, { outcome: string }> | Record<string, { outcome: string }>;
 *   succeeded?: string[];
 *   failed?: Array<{ userId: string }>;
 *   retainedUsers?: Array<{ userId: string; reason?: string }>;
 * }} params
 * @returns {HonestResidueMetrics}
 */
export function computeHonestResidueMetrics(params) {
  const { plan } = params;
  const outcomes = params.outcomes instanceof Map
    ? params.outcomes
    : new Map(Object.entries(params.outcomes ?? {}));

  let terminalDisabled = 0;
  for (const [, row] of outcomes) {
    if (
      row.outcome === "terminal_disabled"
      || row.outcome === "terminal_disabled_verified"
      || row.outcome === "terminal_disabled_session_unverified"
    ) {
      terminalDisabled += 1;
    }
  }

  const retainedImmutable = countRetainedImmutableHistory(plan.retained ?? []);
  const eligibleUsers = Number(plan.counts?.eligible_users ?? 0);
  const failedUsers = params.failed?.length ?? 0;
  const activeOperational = Math.max(0, eligibleUsers - terminalDisabled - (params.succeeded?.length ?? 0));

  const deletableQaResources = (plan.retained ?? []).filter(
    (row) => row.table === "services" || row.table === "zones",
  ).length;

  return {
    active_operational_residue: activeOperational + failedUsers,
    retained_immutable_history: retainedImmutable,
    terminal_disabled_identities: terminalDisabled,
    deletable_QA_resources: deletableQaResources,
    protected_seed_data: 0,
  };
}

/**
 * Design recommendation for future integration runs (no schema migration in this pass).
 */
export const IMMUTABLE_HISTORY_STRATEGY = {
  preventUnlimitedGrowth: [
    "Reuse stable QA fixture identities instead of creating fresh bookings per run when lifecycle residue is expected.",
    "Prefer idempotent fixture setup that attaches to existing retained bookings rather than always inserting new rows.",
    "Cap concurrent QA booking/chat fixtures and track retained_immutable_history in dry-run metrics before execute.",
  ],
  fixtureReuse: "Recommended — reusing QA users with terminal_disabled state avoids compounding immutable rows.",
  disposableDatabase: "Prefer a dedicated disposable QA project with periodic full reset over repeated partial cleanup against shared QA.",
  schemaChangeRequired: false,
  notes: "Immutable triggers are intentional production safeguards; cleanup must retain history and report honestly.",
};
