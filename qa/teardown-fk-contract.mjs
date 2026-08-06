/**
 * Static contract: every teardown table must exist in migrations.
 * Derived from supabase/migrations (82 files). Update when migrations add tables.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEARDOWN_TABLE_LOCATOR_CONTRACT } from "./teardown-row-locators.mjs";
import { assertImmutableTriggerContract } from "./teardown-immutable-contract.mjs";

/** @type {ReadonlySet<string>} */
export const MIGRATION_PUBLIC_TABLES = new Set([
  "addresses",
  "audit_logs",
  "availability_exceptions",
  "availability_rules",
  "booking_cancellations",
  "booking_family_member_snapshots",
  "booking_locations",
  "booking_message_reads",
  "booking_reminder_rules",
  "booking_reminders",
  "booking_requirement_selections",
  "booking_reschedule_requests",
  "booking_status_history",
  "bookings",
  "cancellation_reasons",
  "categories",
  "conversations",
  "coupon_redemptions",
  "coupons",
  "disputes",
  "family_members",
  "favorites",
  "messages",
  "no_show_reports",
  "notification_campaigns",
  "notification_outbox",
  "notification_preferences",
  "notifications",
  "otp_verifications",
  "password_setup_authorizations",
  "payment_methods",
  "payments",
  "profiles",
  "promo_code_categories",
  "promo_code_redemptions",
  "promo_code_services",
  "promo_codes",
  "provider_admin_internal_notes",
  "provider_documents",
  "provider_incidents",
  "provider_onboarding_details",
  "provider_onboarding_events",
  "provider_references",
  "provider_requirement_fulfillments",
  "provider_services",
  "provider_vacations",
  "providers",
  "push_subscriptions",
  "ratings_summary",
  "reviews",
  "service_requirements",
  "services",
  "settings",
  "support_tickets",
  "ticket_messages",
  "transactions",
  "trust_scores",
  "user_roles",
  "verification_records",
  "zone_providers",
  "zone_services",
  "zones",
]);

/** Key columns validated against migration DDL. */
export const MIGRATION_TABLE_KEY_COLUMNS = {
  addresses: ["id"],
  audit_logs: ["id"],
  availability_exceptions: ["id"],
  availability_rules: ["id"],
  booking_cancellations: ["id"],
  booking_family_member_snapshots: ["booking_id"],
  booking_locations: ["booking_id"],
  booking_message_reads: ["booking_id", "user_id"],
  booking_reminders: ["id"],
  booking_requirement_selections: ["id"],
  booking_reschedule_requests: ["id"],
  booking_status_history: ["id"],
  bookings: ["id"],
  cancellation_reasons: ["id"],
  conversations: ["id"],
  disputes: ["id"],
  family_members: ["id"],
  favorites: ["id"],
  messages: ["id"],
  no_show_reports: ["id"],
  notification_campaigns: ["id"],
  notification_outbox: ["id"],
  notifications: ["id"],
  payment_methods: ["id"],
  payments: ["id"],
  profiles: ["id"],
  promo_code_redemptions: ["id"],
  promo_codes: ["id"],
  provider_admin_internal_notes: ["provider_id"],
  provider_documents: ["id"],
  provider_incidents: ["id"],
  provider_onboarding_details: ["provider_id"],
  provider_onboarding_events: ["id"],
  provider_references: ["id"],
  provider_requirement_fulfillments: ["id"],
  provider_services: ["id"],
  provider_vacations: ["id"],
  providers: ["id"],
  push_subscriptions: ["id"],
  ratings_summary: ["provider_id"],
  reviews: ["id"],
  service_requirements: ["id"],
  services: ["id"],
  support_tickets: ["id"],
  ticket_messages: ["id"],
  trust_scores: ["provider_id"],
  user_roles: ["id"],
  verification_records: ["id"],
  zone_providers: ["id"],
  zone_services: ["id"],
  zones: ["id"],
  "auth.users": ["id"],
};

/**
 * @param {string[]} tableNames
 * @returns {{ ok: true } | { ok: false; missing: string[] }}
 */
export function validateTeardownTableNames(tableNames) {
  /** @type {string[]} */
  const missing = [];
  for (const table of tableNames) {
    if (!MIGRATION_PUBLIC_TABLES.has(table) && table !== "auth.users") missing.push(table);
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Whole-plan deletion bypasses are forbidden — all mutations use per-user/per-resource slices. */
export const FORBIDDEN_TEARDOWN_BYPASS_NAMES = [
  "executeCleanupPlanDeletions",
];

/**
 * @param {string} source
 */
export function assertNoWholePlanDeletionBypass(source) {
  for (const name of FORBIDDEN_TEARDOWN_BYPASS_NAMES) {
    if (source.includes(name)) {
      throw new Error(`Forbidden whole-plan deletion bypass: ${name}`);
    }
  }
}

/** @param {Array<{ table?: string }>} steps */
export function assertTeardownStepsExist(steps) {
  const tables = steps.map((step) => step.table).filter(Boolean);
  const result = validateTeardownTableNames(tables);
  if (!result.ok) {
    throw new Error(`Teardown references nonexistent tables: ${result.missing.join(", ")}`);
  }
}

/**
 * @param {string[]} tables
 */
export function assertTeardownLocatorCoverage(tables) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const columnMismatches = [];

  for (const table of [...new Set(tables)]) {
    const contract = TEARDOWN_TABLE_LOCATOR_CONTRACT[table];
    if (!contract) {
      missing.push(table);
      continue;
    }
    const migrationColumns = MIGRATION_TABLE_KEY_COLUMNS[table];
    if (!migrationColumns) {
      columnMismatches.push(`${table}: no migration key column map`);
      continue;
    }
    if (JSON.stringify([...contract.keyColumns].sort()) !== JSON.stringify([...migrationColumns].sort())) {
      columnMismatches.push(`${table}: contract=${contract.keyColumns.join(",")} migration=${migrationColumns.join(",")}`);
    }
    if (contract.kind === "composite" && contract.keyColumns.length < 2) {
      columnMismatches.push(`${table}: composite locator missing columns`);
    }
  }

  if (missing.length) {
    throw new Error(`Teardown tables missing explicit locator contract: ${missing.join(", ")}`);
  }
  if (columnMismatches.length) {
    throw new Error(`Teardown locator column mismatches: ${columnMismatches.join("; ")}`);
  }
}

/**
 * @param {string[]} relativePaths
 */
export function assertNoBlindIdSelectInTeardownModules(relativePaths) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const rel of relativePaths) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    if (/getTeardownRowKeyColumn|TEARDOWN_ROW_KEY_COLUMN/.test(source)) {
      throw new Error(`${rel} still uses deprecated row-key column fallback`);
    }
    if (/\.select\(["']id["']\)\.in\(step\.column/.test(source)) {
      throw new Error(`${rel} contains blind select("id") for scoped discovery`);
    }
  }
}

assertNoBlindIdSelectInTeardownModules([
  "qa/teardown-planner.mjs",
  "qa/teardown-operations.mjs",
]);

assertImmutableTriggerContract();
