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

  for (const u of reg.users ?? []) {
    await supabaseAdmin.from("providers").delete().eq("profile_id", u.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", u.userId);
    await supabaseAdmin.from("profiles").delete().eq("id", u.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(u.userId);
    if (error) console.error(`[qa-teardown] deleteUser ${u.key} error:`, error.message);
  }

  console.log(`[qa-teardown] removed ${reg.users?.length ?? 0} QA users and tagged rows.`);
  writeRegistry({ users: [] });
}
