import { supabaseAdmin } from "./admin-client.mjs";
import { readRegistry, writeRegistry } from "./registry.mjs";

/** Tables where QA_ write-tests may leave a row, keyed by the column that carries the QA_ tag. */
const QA_TAGGED_TABLES = [
  { table: "services", column: "name_en" },
  { table: "promo_codes", column: "code" },
  { table: "zones", column: "name_en" },
  { table: "notification_campaigns", column: "title_en" },
  { table: "payment_methods", column: "name_en" },
  { table: "cancellation_reasons", column: "name_en" },
  { table: "bookings", column: "notes" },
];

export async function runTeardown() {
  const reg = readRegistry();

  for (const { table, column } of QA_TAGGED_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().ilike(column, "QA_%");
    if (error) console.error(`[qa-teardown] ${table} cleanup error:`, error.message);
  }

  // Union registry-tracked ids with a profile-tag sweep, so accounts orphaned
  // by an interrupted or KEEP_QA_DATA=1 run (registry reset before they were
  // cleaned) still get removed.
  const ids = new Set((reg.users ?? []).map((u) => u.userId));
  const { data: taggedProfiles } = await supabaseAdmin.from("profiles").select("id").ilike("full_name", "QA_%");
  for (const p of taggedProfiles ?? []) ids.add(p.id);

  for (const userId of ids) {
    await supabaseAdmin.from("providers").delete().eq("profile_id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    await supabaseAdmin.from("profiles").delete().eq("id", userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error && error.message !== "User not found") console.error(`[qa-teardown] deleteUser ${userId} error:`, error.message);
  }

  console.log(`[qa-teardown] removed ${ids.size} QA users and tagged rows.`);
  writeRegistry({ users: [] });
}
