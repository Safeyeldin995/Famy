/**
 * Explicit row-locator contracts for every teardown table — derived from migrations.
 * No silent fallback to select("id").
 */
import { formatTeardownError, logTeardownError } from "./teardown-errors.mjs";

/** @typedef {"single" | "composite" | "immutable"} LocatorKind */
/** @typedef {{ kind: LocatorKind; columns: string[]; keys: Array<Record<string, string>>; scopeColumn?: string; scopeValues?: string[] }} RowLocator */

/** @type {Record<string, { kind: LocatorKind; keyColumns: string[]; discoveryScopeColumn?: string }>} */
export const TEARDOWN_TABLE_LOCATOR_CONTRACT = {
  notification_outbox: { kind: "single", keyColumns: ["id"] },
  booking_reminders: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  promo_code_redemptions: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_requirement_selections: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_family_member_snapshots: { kind: "single", keyColumns: ["booking_id"], discoveryScopeColumn: "booking_id" },
  booking_message_reads: { kind: "composite", keyColumns: ["booking_id", "user_id"], discoveryScopeColumn: "booking_id" },
  messages: { kind: "immutable", keyColumns: ["id"] },
  conversations: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_reschedule_requests: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  disputes: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  no_show_reports: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_cancellations: { kind: "immutable", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_status_history: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  payments: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  booking_locations: { kind: "single", keyColumns: ["booking_id"], discoveryScopeColumn: "booking_id" },
  notifications: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "booking_id" },
  bookings: { kind: "single", keyColumns: ["id"] },
  providers: { kind: "single", keyColumns: ["id"] },
  provider_onboarding_events: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_references: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_onboarding_details: { kind: "single", keyColumns: ["provider_id"], discoveryScopeColumn: "provider_id" },
  provider_documents: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_requirement_fulfillments: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_admin_internal_notes: { kind: "single", keyColumns: ["provider_id"], discoveryScopeColumn: "provider_id" },
  availability_rules: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  availability_exceptions: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_services: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  zone_providers: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_incidents: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  provider_vacations: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  verification_records: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  favorites: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  reviews: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "provider_id" },
  ratings_summary: { kind: "single", keyColumns: ["provider_id"], discoveryScopeColumn: "provider_id" },
  trust_scores: { kind: "single", keyColumns: ["provider_id"], discoveryScopeColumn: "provider_id" },
  ticket_messages: { kind: "immutable", keyColumns: ["id"] },
  support_tickets: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "user_id" },
  addresses: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "user_id" },
  push_subscriptions: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "user_id" },
  family_members: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "customer_id" },
  user_roles: { kind: "single", keyColumns: ["id"], discoveryScopeColumn: "user_id" },
  profiles: { kind: "single", keyColumns: ["id"] },
  "auth.users": { kind: "single", keyColumns: ["id"] },
  audit_logs: { kind: "immutable", keyColumns: ["id"] },
  promo_codes: { kind: "single", keyColumns: ["id"] },
  notification_campaigns: { kind: "single", keyColumns: ["id"] },
  payment_methods: { kind: "single", keyColumns: ["id"] },
  cancellation_reasons: { kind: "single", keyColumns: ["id"] },
  services: { kind: "single", keyColumns: ["id"] },
  zones: { kind: "single", keyColumns: ["id"] },
  zone_services: { kind: "single", keyColumns: ["id"] },
  service_requirements: { kind: "single", keyColumns: ["id"] },
};

/**
 * @param {string} table
 */
export function getLocatorContract(table) {
  const contract = TEARDOWN_TABLE_LOCATOR_CONTRACT[table];
  if (!contract) {
    throw new Error(`[teardown-locator] Missing explicit locator contract for table: ${table}`);
  }
  return contract;
}

/**
 * @param {Record<string, string>} row
 * @param {string[]} columns
 */
function pickKey(row, columns) {
  /** @type {Record<string, string>} */
  const key = {};
  for (const column of columns) {
    if (row[column] == null) {
      throw new Error(`[teardown-locator] Missing key column ${column} in discovery row`);
    }
    key[column] = String(row[column]);
  }
  return key;
}

/**
 * @param {RowLocator} locator
 */
export function canonicalizeLocator(locator) {
  const sortedKeys = [...locator.keys].map((key) => {
    /** @type {Record<string, string>} */
    const normalized = {};
    for (const column of locator.columns) normalized[column] = key[column];
    return normalized;
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return {
    kind: locator.kind,
    columns: [...locator.columns],
    keys: sortedKeys,
    scopeColumn: locator.scopeColumn ?? null,
    scopeValues: locator.scopeValues ? [...locator.scopeValues].sort() : null,
  };
}

/**
 * @param {LocatorKind} kind
 * @param {string[]} columns
 * @param {Array<Record<string, string>>} keys
 */
export function makeLocatorFromKeys(kind, columns, keys) {
  return {
    kind,
    columns: [...columns],
    keys: keys.map((key) => pickKey(key, columns)),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} table
 * @param {string} scopeColumn
 * @param {string[]} scopeValues
 */
export async function discoverScopedLocatorKeys(admin, table, scopeColumn, scopeValues) {
  const contract = getLocatorContract(table);
  if (!scopeValues.length) {
    return makeLocatorFromKeys(contract.kind, contract.keyColumns, []);
  }
  if (contract.kind === "immutable") {
    throw new Error(`[teardown-locator] Cannot discover deletions for immutable table: ${table}`);
  }

  const selectCols = contract.keyColumns.join(",");
  const { data, error } = await admin.from(table).select(selectCols).in(scopeColumn, scopeValues);
  if (error) throw error;

  return makeLocatorFromKeys(contract.kind, contract.keyColumns, data ?? []);
}

/**
 * @param {string} table
 * @param {string[]} values
 */
export function makeRootLocator(table, values) {
  const contract = getLocatorContract(table);
  if (contract.kind === "immutable") {
    throw new Error(`[teardown-locator] Cannot build deletion locator for immutable table: ${table}`);
  }
  const keys = values.map((value) => {
    const key = {};
    key[contract.keyColumns[0]] = value;
    return key;
  });
  return makeLocatorFromKeys(contract.kind, contract.keyColumns, keys);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} table
 * @param {RowLocator} locator
 * @param {Array<ReturnType<typeof formatTeardownError>>} errors
 */
export async function executeLocatorDeletion(admin, table, locator, errors) {
  const contract = getLocatorContract(table);
  if (contract.kind === "immutable") {
    throw new Error(`[teardown-locator] Refusing to delete immutable table: ${table}`);
  }

  for (const key of locator.keys) {
    let query = admin.from(table).delete();
    for (const column of locator.columns) {
      query = query.eq(column, key[column]);
    }
    const { error } = await query;
    if (error) {
      const entry = formatTeardownError({
        operation: "delete",
        table,
        id: locator.columns.map((column) => key[column]).join(":"),
        error,
      });
      errors.push(entry);
      logTeardownError(entry);
    }
  }
}

/**
 * @param {{ locator?: RowLocator; table: string }} row
 */
export function locatorKeyCount(row) {
  return row.locator?.keys.length ?? 0;
}

/**
 * @param {{ locator?: RowLocator; table: string }} row
 */
export function firstLocatorToken(row) {
  if (row.locator?.keys?.[0]) {
    return Object.values(row.locator.keys[0]).join(":");
  }
  return "";
}

/**
 * @param {Array<{ table: string; locator: RowLocator; ownerUserId?: string; phase: string; resourceKey?: string }>} deletions
 * @param {{ table: string; locator: RowLocator; ownerUserId?: string; phase: string; resourceKey?: string }} entry
 */
export function pushPlanDeletion(deletions, entry) {
  if (!entry.locator.keys.length) return;
  deletions.push(entry);
}
