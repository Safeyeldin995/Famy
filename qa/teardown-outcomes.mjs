/**
 * Documented database state for each cleanup outcome (PATCH 6A.2).
 *
 * succeeded:
 *   auth.users — absent (hard deleted)
 *   profiles — absent
 *   user_roles — absent
 *   owned bookings/providers/addresses/notifications — absent
 *   immutable audit_logs / ticket_messages — absent unless never existed
 *
 * terminal_disabled:
 *   auth.users — present, banned (ban_until future), password randomized, sessions revoked
 *   profiles — present, is_suspended=true, QA_ full_name preserved
 *   user_roles — admin removed; other roles may remain
 *   owned transactional data — deleted (bookings, providers, addresses, etc.)
 *   immutable audit_logs / ticket_messages / support_tickets — retained (FK-bound)
 *   registry — user ID kept with recovery entry
 *
 * failed:
 *   auth.users — present, active (not verified banned)
 *   profiles — present, QA classification evidence preserved (not deleted)
 *   partial safe deletes may have occurred
 *   registry — user ID kept with recovery entry
 *
 * retained (per-user execution residue, not terminal):
 *   same as failed; used when residue remains but disable was not attempted or verified
 *
 * refused:
 *   zero mutations; auth + profile unchanged; not in eligible set
 */

export const OUTCOME_LABELS = {
  SUCCEEDED: "succeeded",
  HARD_DELETED: "hard_deleted",
  TERMINAL_DISABLED: "terminal_disabled",
  TERMINAL_DISABLED_VERIFIED: "terminal_disabled_verified",
  TERMINAL_DISABLED_SESSION_UNVERIFIED: "terminal_disabled_session_unverified",
  RETAINED_IMMUTABLE_HISTORY: "retained_immutable_history",
  DISABLE_FAILED: "disable_failed",
  FAILED: "failed",
  RETAINED: "retained",
  REFUSED: "refused",
};

/** Terminal-disable outcomes never count as hard deletion or zero baseline. */
export const TERMINAL_DISABLE_OUTCOMES = new Set([
  OUTCOME_LABELS.TERMINAL_DISABLED,
  OUTCOME_LABELS.TERMINAL_DISABLED_VERIFIED,
  OUTCOME_LABELS.TERMINAL_DISABLED_SESSION_UNVERIFIED,
  OUTCOME_LABELS.RETAINED_IMMUTABLE_HISTORY,
]);
