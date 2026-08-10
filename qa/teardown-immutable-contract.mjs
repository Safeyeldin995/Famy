/**
 * Immutable booking/support history contract — derived from migration triggers.
 * Locator and planner modules must treat these tables as non-deletable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Tables with unconditional BEFORE UPDATE OR DELETE immutability triggers. */
export const IMMUTABLE_TEARDOWN_TABLES = new Set([
  "audit_logs",
  "booking_cancellations",
  "messages",
  "ticket_messages",
]);

/**
 * Parent tables that cannot be deleted when immutable children remain.
 * @type {Record<string, { childTable: string; linkColumn: string; parentKey: string }[]>}
 */
export const IMMUTABLE_PARENT_RETENTION = {
  conversations: [{ childTable: "messages", linkColumn: "conversation_id", parentKey: "id" }],
  bookings: [
    { childTable: "booking_cancellations", linkColumn: "booking_id", parentKey: "id" },
    { childTable: "messages", linkColumn: "conversation_id", parentKey: "id", viaTable: "conversations", viaLink: "booking_id" },
    { childTable: "audit_logs", linkColumn: "booking_id", parentKey: "id" },
  ],
};

/** Expected unconditional immutable triggers — contract fails if any are missing from migrations. */
export const REQUIRED_IMMUTABLE_TRIGGERS = {
  audit_logs: "trg_audit_logs_immutable",
  booking_cancellations: "trg_cancellation_immutable",
  messages: "trg_messages_immutable",
  ticket_messages: "trg_ticket_messages_immutable",
};

/**
 * @param {string} table
 */
export function isImmutableTeardownTable(table) {
  return IMMUTABLE_TEARDOWN_TABLES.has(table);
}

/**
 * Fail closed when a required immutable trigger is absent from migration SQL.
 */
export function assertImmutableTriggerContract() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsDir = path.join(root, "supabase", "migrations");
  const sql = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");

  /** @type {string[]} */
  const missing = [];
  for (const [table, triggerName] of Object.entries(REQUIRED_IMMUTABLE_TRIGGERS)) {
    const pattern = new RegExp(`CREATE TRIGGER\\s+${triggerName}\\s+`, "i");
    if (!pattern.test(sql)) {
      missing.push(`${table}:${triggerName}`);
    }
  }

  if (missing.length) {
    throw new Error(
      `[teardown-immutable] Missing required immutable triggers in migrations: ${missing.join(", ")}`,
    );
  }
}

assertImmutableTriggerContract();
