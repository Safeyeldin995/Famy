/**
 * Audit-log FK design notes for QA cleanup (read-only analysis — no schema changes).
 *
 * Evidence from migrations:
 * - audit_logs.actor_id uuid REFERENCES auth.users(id) — default ON DELETE NO ACTION / RESTRICT
 * - trg_audit_logs_immutable blocks UPDATE and DELETE on audit_logs rows
 * - booking_id on audit_logs uses ON DELETE SET NULL but actor_id has no SET NULL
 *
 * Fixture actions that create audit rows with QA user as actor:
 * - tg_audit_changes() on provider tables, bookings, payments, promo_codes, etc.
 * - provider_onboarding_events inserts with actor_id
 * - Any admin/provider RPC that mutates audited tables during integration tests
 *
 * Consequence:
 * - auth.admin.deleteUser() fails while audit_logs.actor_id references the user (FK RESTRICT)
 * - ON DELETE SET NULL on actor_id would itself require UPDATE on audit_logs — blocked by immutability trigger
 *
 * Durable options (for future approved migration — NOT implemented here):
 * 1. terminal_disabled registry state: ban/suspend auth, exclude from zero-baseline candidate count
 * 2. QA fixture policy: avoid QA user IDs as audit actor (use null/system actor where schema allows)
 * 3. Approved SECURITY DEFINER anonymization RPC (separate sprint): SET actor_id NULL via trigger bypass — high risk
 * 4. Retention partition: archive audit rows older than N days to cold storage — does not help QA short-lived users
 *
 * Current cleanup behavior until approved:
 * - audit_logs(actor) residue => terminal_disabled / retained — never succeeded
 * - ban/suspend is NOT full deletion and NOT zero-baseline success
 */

export const AUDIT_LOG_ACTOR_FK = "audit_logs.actor_id REFERENCES auth.users(id) ON DELETE NO ACTION";
export const AUDIT_LOG_IMMUTABLE_TRIGGER = "trg_audit_logs_immutable";
