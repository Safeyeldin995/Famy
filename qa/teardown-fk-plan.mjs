/**
 * FK-safe deletion plans derived from migrations — pure data for tests and teardown.
 */
import { assertTeardownStepsExist, assertTeardownLocatorCoverage } from "./teardown-fk-contract.mjs";

/** Child tables deleted before bookings row — deepest dependents first. */
export const BOOKING_CHILD_DELETE_STEPS = [
  { table: "notification_outbox", viaNotifications: true },
  { table: "booking_reminders", column: "booking_id" },
  { table: "promo_code_redemptions", column: "booking_id" },
  { table: "booking_requirement_selections", column: "booking_id" },
  { table: "booking_family_member_snapshots", column: "booking_id" },
  { table: "booking_message_reads", column: "booking_id" },
  { table: "messages", viaConversation: true },
  { table: "conversations", column: "booking_id" },
  { table: "booking_reschedule_requests", column: "booking_id" },
  { table: "disputes", column: "booking_id" },
  { table: "no_show_reports", column: "booking_id" },
  { table: "booking_cancellations", column: "booking_id" },
  { table: "booking_status_history", column: "booking_id" },
  { table: "payments", column: "booking_id" },
  { table: "booking_locations", column: "booking_id" },
  { table: "notifications", column: "booking_id" },
];

/** Provider-owned tables deleted before providers row. */
export const PROVIDER_DELETE_STEPS = [
  { table: "provider_onboarding_events", column: "provider_id" },
  { table: "provider_references", column: "provider_id" },
  { table: "provider_onboarding_details", column: "provider_id" },
  { table: "provider_documents", column: "provider_id" },
  { table: "provider_requirement_fulfillments", column: "provider_id" },
  { table: "provider_admin_internal_notes", column: "provider_id" },
  { table: "availability_rules", column: "provider_id" },
  { table: "availability_exceptions", column: "provider_id" },
  { table: "provider_services", column: "provider_id" },
  { table: "zone_providers", column: "provider_id" },
  { table: "provider_incidents", column: "provider_id" },
  { table: "provider_vacations", column: "provider_id" },
  { table: "verification_records", column: "provider_id" },
  { table: "favorites", column: "provider_id" },
  { table: "reviews", column: "provider_id" },
  { table: "ratings_summary", column: "provider_id" },
  { table: "trust_scores", column: "provider_id" },
];

/** User-scoped tables cleaned after bookings/providers, before profile/auth. */
export const USER_SCOPED_DELETE_STEPS = [
  { table: "ticket_messages", viaSupportTickets: true },
  { table: "addresses", column: "user_id" },
  { table: "notification_outbox", column: "recipient_user_id" },
  { table: "notifications", column: "user_id" },
  { table: "push_subscriptions", column: "user_id" },
  { table: "family_members", column: "customer_id" },
  { table: "support_tickets", column: "user_id" },
  { table: "user_roles", column: "user_id" },
];

/** Generic QA-tagged catalog rows (not user-owned). */
export const QA_TAGGED_RESOURCE_DEFS = [
  { table: "promo_codes", column: "code", referenceChecks: [{ table: "promo_code_redemptions", column: "promo_code_id" }] },
  { table: "notification_campaigns", column: "title_en", referenceChecks: [{ table: "notifications", column: "campaign_id" }] },
  { table: "payment_methods", column: "name_en", referenceChecks: [{ table: "payments", column: "payment_method_id" }] },
  { table: "cancellation_reasons", column: "name_en", referenceChecks: [{ table: "booking_cancellations", column: "reason_id" }] },
];

const ALL_TEARDOWN_TABLES = [
  ...BOOKING_CHILD_DELETE_STEPS.map((step) => step.table).filter(Boolean),
  ...PROVIDER_DELETE_STEPS.map((step) => step.table),
  ...USER_SCOPED_DELETE_STEPS.map((step) => step.table).filter(Boolean),
  ...QA_TAGGED_RESOURCE_DEFS.map((def) => def.table),
  ...QA_TAGGED_RESOURCE_DEFS.flatMap((def) => (def.referenceChecks ?? []).map((check) => check.table)),
  "services",
  "zones",
  "zone_services",
  "service_requirements",
  "profiles",
  "bookings",
  "providers",
  "auth.users",
];

assertTeardownStepsExist(ALL_TEARDOWN_TABLES.map((table) => ({ table })));
assertTeardownLocatorCoverage(ALL_TEARDOWN_TABLES);

/**
 * Discover booking IDs owned by an eligible user (no notes/status filter).
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {string[]} providerIds
 */
export async function discoverOwnedBookingIds(admin, userId, providerIds) {
  /** @type {Set<string>} */
  const ids = new Set();

  const { data: customerBookings, error: customerError } = await admin
    .from("bookings")
    .select("id")
    .eq("customer_id", userId);
  if (customerError) throw customerError;
  for (const row of customerBookings ?? []) ids.add(row.id);

  if (providerIds.length > 0) {
    const { data: providerBookings, error: providerError } = await admin
      .from("bookings")
      .select("id")
      .in("provider_id", providerIds);
    if (providerError) throw providerError;
    for (const row of providerBookings ?? []) ids.add(row.id);
  }

  return [...ids];
}

/**
 * Matches PostgreSQL ILIKE 'QA_%' (QA + any one char + rest).
 * @param {string | null | undefined} name
 */
export function isQaTaggedName(name) {
  return typeof name === "string" && /^QA./i.test(name);
}

/**
 * Seeded catalog services never use QA_ prefix — block accidental deletion.
 * @param {{ name_en?: string | null; slug?: string | null }} row
 */
export function isProtectedSeededCatalogRow(row) {
  if (!row?.name_en) return true;
  return !isQaTaggedName(row.name_en);
}
