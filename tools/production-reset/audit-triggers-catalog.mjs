/**
 * Audit triggers catalog — verified from supabase/migrations (read-only static).
 * No migration defines tg_audit_* on auth.users or storage.objects.
 */
export const AUDIT_TRIGGER_TABLES = [
  { table: "audit_logs", trigger: "trg_audit_logs_immutable", events: "UPDATE, DELETE (block)" },
  { table: "services", trigger: "trg_audit_services", events: "INSERT, UPDATE, DELETE" },
  { table: "zones", trigger: "trg_audit_zones", events: "INSERT, UPDATE, DELETE" },
  { table: "zone_services", trigger: "trg_audit_zone_services", events: "INSERT, DELETE" },
  { table: "zone_providers", trigger: "trg_audit_zone_providers", events: "INSERT, DELETE" },
  { table: "bookings", trigger: "trg_audit_bookings", events: "INSERT, UPDATE, DELETE" },
  { table: "providers", trigger: "trg_audit_providers", events: "INSERT, UPDATE, DELETE" },
  { table: "provider_services", trigger: "trg_audit_provider_services", events: "INSERT, UPDATE, DELETE" },
  { table: "payments", trigger: "trg_audit_payments", events: "INSERT, UPDATE" },
  { table: "promo_codes", trigger: "trg_audit_promo_codes", events: "INSERT, UPDATE, DELETE" },
  { table: "payment_methods", trigger: "trg_audit_payment_methods", events: "INSERT, UPDATE, DELETE" },
  { table: "cancellation_reasons", trigger: "trg_audit_cancellation_reasons", events: "INSERT, UPDATE, DELETE" },
  { table: "booking_reminder_rules", trigger: "trg_audit_booking_reminder_rules", events: "INSERT, UPDATE, DELETE" },
  { table: "booking_cancellations", trigger: "trg_audit_booking_cancellations", events: "INSERT" },
  { table: "notification_campaigns", trigger: "trg_audit_notification_campaigns", events: "INSERT, UPDATE, DELETE" },
  { table: "notification_outbox", trigger: "trg_audit_notification_outbox", events: "UPDATE" },
  { table: "support_tickets", trigger: "trg_audit_support_tickets", events: "INSERT, UPDATE" },
  { table: "disputes", trigger: "trg_audit_disputes", events: "INSERT, UPDATE" },
  { table: "no_show_reports", trigger: "trg_audit_no_show_reports", events: "INSERT, UPDATE" },
  { table: "booking_reschedule_requests", trigger: "trg_audit_reschedule", events: "INSERT, UPDATE, DELETE" },
  { table: "provider_vacations", trigger: "trg_audit_provider_vacations", events: "INSERT, UPDATE, DELETE" },
  { table: "availability_exceptions", trigger: "trg_audit_availability_exceptions", events: "INSERT, UPDATE, DELETE" },
  { table: "provider_requirement_fulfillments", trigger: "trg_audit_requirement_fulfillment", events: "INSERT, UPDATE, DELETE" },
  { table: "verification_records", trigger: "trg_audit_verification", events: "INSERT, UPDATE, DELETE" },
  { table: "reviews", trigger: "trg_audit_reviews", events: "INSERT, UPDATE, DELETE" },
];

/** Tables that write audit_logs during Phase B service DELETE. */
export const PHASE_B_AUDIT_WRITERS = ["services"];

/** Verified absent: no audit trigger on these targets. */
export const NO_AUDIT_TRIGGER_TARGETS = ["auth.users", "storage.objects"];
