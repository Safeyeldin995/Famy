/**
 * User full-removal verification predicates derived from migrations.
 * Each entry documents the exact column predicate used at runtime.
 *
 * Migration sources:
 * - profiles.id (PK, matches auth.users)
 * - user_roles.user_id -> auth.users
 * - providers.profile_id -> profiles ON DELETE CASCADE
 * - bookings.customer_id -> profiles ON DELETE RESTRICT
 * - bookings.provider_id -> providers ON DELETE RESTRICT
 * - addresses.user_id -> auth.users ON DELETE CASCADE
 * - notification_outbox.recipient_user_id
 * - notifications.user_id -> auth.users ON DELETE CASCADE
 * - push_subscriptions.user_id
 * - family_members.customer_id
 * - support_tickets.user_id -> auth.users ON DELETE CASCADE
 * - ticket_messages.ticket_id -> support_tickets; author_id -> auth.users (immutable trigger)
 * - audit_logs.actor_id -> auth.users (no ON DELETE; immutable trigger blocks mutation)
 */

/** @typedef {{ label: string; table: string; kind: "auth" | "count" | "rows" | "audit" }} RemovalPredicate */

/** @type {RemovalPredicate[]} */
export const USER_REMOVAL_PREDICATES = [
  { label: "auth.users", table: "auth.users", kind: "auth" },
  { label: "profiles", table: "profiles", kind: "rows", column: "id" },
  { label: "user_roles", table: "user_roles", kind: "count", column: "user_id" },
  { label: "providers", table: "providers", kind: "rows", column: "profile_id" },
  { label: "bookings(customer)", table: "bookings", kind: "count", column: "customer_id" },
  { label: "bookings(provider)", table: "bookings", kind: "provider_bookings" },
  { label: "addresses", table: "addresses", kind: "count", column: "user_id" },
  { label: "notification_outbox(recipient)", table: "notification_outbox", kind: "count", column: "recipient_user_id" },
  { label: "notifications", table: "notifications", kind: "count", column: "user_id" },
  { label: "push_subscriptions", table: "push_subscriptions", kind: "count", column: "user_id" },
  { label: "family_members", table: "family_members", kind: "count", column: "customer_id" },
  { label: "support_tickets", table: "support_tickets", kind: "count", column: "user_id" },
  { label: "ticket_messages(author)", table: "ticket_messages", kind: "count", column: "author_id" },
  { label: "ticket_messages(via_ticket)", table: "ticket_messages", kind: "ticket_messages_via_support" },
  { label: "audit_logs(actor)", table: "audit_logs", kind: "audit", column: "actor_id" },
];

/** Labels that indicate immutable history prevents hard auth deletion. */
export const TERMINAL_DISABLED_LABELS = new Set(["audit_logs(actor)"]);

/** Labels for immutable support history that block full removal. */
export const IMMUTABLE_SUPPORT_LABELS = new Set([
  "ticket_messages(author)",
  "ticket_messages(via_ticket)",
  "support_tickets",
]);

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function verifyUserFullyRemoved(admin, userId) {
  /** @type {string[]} */
  const remaining = [];

  for (const predicate of USER_REMOVAL_PREDICATES) {
    if (predicate.kind === "auth") {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
      if (!authError && authData?.user && !authData.user.deleted_at) remaining.push(predicate.label);
      continue;
    }

    if (predicate.kind === "rows") {
      const { data } = await admin.from(predicate.table).select("id").eq(predicate.column, userId);
      if ((data?.length ?? 0) > 0) remaining.push(predicate.label);
      continue;
    }

    if (predicate.kind === "count") {
      const { count } = await admin
        .from(predicate.table)
        .select("id", { count: "exact", head: true })
        .eq(predicate.column, userId);
      if ((count ?? 0) > 0) remaining.push(predicate.label);
      continue;
    }

    if (predicate.kind === "provider_bookings") {
      const { data: providers } = await admin.from("providers").select("id").eq("profile_id", userId);
      if (providers?.length) {
        const { count } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .in("provider_id", providers.map((row) => row.id));
        if ((count ?? 0) > 0) remaining.push(predicate.label);
      }
      continue;
    }

    if (predicate.kind === "ticket_messages_via_support") {
      const { data: tickets } = await admin.from("support_tickets").select("id").eq("user_id", userId);
      const ticketIds = (tickets ?? []).map((row) => row.id);
      if (ticketIds.length) {
        const { count } = await admin
          .from("ticket_messages")
          .select("id", { count: "exact", head: true })
          .in("ticket_id", ticketIds);
        if ((count ?? 0) > 0) remaining.push(predicate.label);
      }
      continue;
    }

    if (predicate.kind === "audit") {
      const { count } = await admin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq(predicate.column, userId);
      if ((count ?? 0) > 0) remaining.push(predicate.label);
    }
  }

  const terminalDisabled = remaining.some((label) => TERMINAL_DISABLED_LABELS.has(label));
  return { removed: remaining.length === 0, remaining, terminalDisabled };
}
