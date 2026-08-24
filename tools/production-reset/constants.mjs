/** Hard-coded Production identity — inverse of qa/ non-QA guard. */
export const PRODUCTION_PROJECT_REF = "mjhkaiabfnzewprcnojp";

export const RESET_CONFIRM_VALUE = "I-UNDERSTAND-PRODUCTION-USER-DATA-RESET";

export const PLAN_VERSION = "production-reset-v1";

/** Phase A: explicit TRUNCATE … CASCADE roots (public schema only). */
export const PHASE_A_TRUNCATE_ROOTS = [
  "bookings",
  "providers",
  "zones",
  "profiles",
  "user_roles",
  "addresses",
  "family_members",
  "favorites",
  "otp_verifications",
  "password_setup_authorizations",
  "push_subscriptions",
  "notification_preferences",
  "notification_campaigns",
];

/** Catalog tables that must never appear in Phase A closure. */
export const CATALOG_KEEP_TABLES = new Set([
  "categories",
  "payment_methods",
  "cancellation_reasons",
  "booking_reminder_rules",
  "settings",
  "promo_codes",
  "promo_code_categories",
  "coupons",
  "services", // partial keep — 18 seed rows after Phase B
]);

export const STORAGE_BUCKETS = [
  "avatars",
  "provider-documents",
  "payment-proofs",
  "case-evidence",
];
