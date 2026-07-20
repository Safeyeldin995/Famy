import { supabaseAdmin } from "./admin-client.mjs";
import { readRegistry, writeRegistry } from "./registry.mjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assertNoPendingRestorations, restorePendingRestorations } from "./restoration-registry.mjs";

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

async function assertQaIdentityDisabled(userId) {
  const [{ data: authData, error: authError }, profile, roles, provider] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin.from("profiles").select("id,is_suspended").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("user_id").eq("user_id", userId),
    supabaseAdmin.from("providers").select("id,is_active,is_verified").eq("profile_id", userId),
  ]);

  if ((profile.data && !profile.data.is_suspended) || (roles.data?.length ?? 0) > 0 || (provider.data?.some((p) => p.is_active || p.is_verified) ?? false)) {
    throw new Error(`[qa-teardown] QA identity ${userId} still has an active profile, role, or provider record.`);
  }

  if (!authError && authData.user && !authData.user.deleted_at && !authData.user.banned_until) {
    throw new Error(`[qa-teardown] QA auth identity ${userId} remains active after cleanup.`);
  }
}

async function disableOrDeleteQaIdentity(userId) {
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (!deleteError || deleteError.message === "User not found") return;

  console.error(`[qa-teardown] hard deleteUser ${userId} failed:`, deleteError.message || deleteError);

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
    password: crypto.randomBytes(48).toString("base64url"),
  });
  if (banError && banError.message !== "User not found") {
    console.error(`[qa-teardown] disabling QA identity ${userId} failed:`, banError.message || banError);
  }

  const { error: softDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId, true);
  if (softDeleteError && softDeleteError.message !== "User not found") {
    console.error(`[qa-teardown] soft deleteUser ${userId} failed:`, softDeleteError.message || softDeleteError);
  }
}

export async function runTeardown() {
  // This is deliberately first and last: global settings must be restored even
  // if identity/fixture cleanup later encounters retained history.
  await restorePendingRestorations();
  const reg = readRegistry();

  // Booking history/audit dependencies can make hard deletion impossible.
  // First neutralize only reserved QA-tagged active rows so interruption can
  // never leave a bookable/in-progress synthetic record behind.
  const { error: neutralizeBookingsError } = await supabaseAdmin
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: "QA_ teardown recovery" })
    .ilike("notes", "QA_%")
    .in("status", ["pending", "confirmed", "in_progress"]);
  if (neutralizeBookingsError) throw new Error(`[qa-teardown] could not neutralize active QA bookings: ${neutralizeBookingsError.message}`);

  const { data: qaZones } = await supabaseAdmin.from("zones").select("id").ilike("name_en", "QA_%");
  for (const zone of qaZones ?? []) {
    await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone.id);
    await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone.id);
  }

  for (const { table, column } of QA_TAGGED_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().ilike(column, "QA_%");
    if (error && table === "zones") {
      await supabaseAdmin.from("zones").update({ is_active: false }).ilike("name_en", "QA_%");
    } else if (error && table === "services") {
      // Audited QA bookings are intentionally retained as cancelled history,
      // so their referenced service cannot be hard-deleted. Neutralize it.
      const { error: neutralizeServiceError } = await supabaseAdmin.from("services").update({ is_active: false }).ilike("name_en", "QA_%");
      if (neutralizeServiceError) throw new Error(`[qa-teardown] could not neutralize QA services: ${neutralizeServiceError.message}`);
    } else if (error && table !== "bookings") {
      console.error(`[qa-teardown] ${table} cleanup error:`, error.message);
    }
  }

  // Union registry-tracked ids with a profile-tag sweep, so accounts orphaned
  // by an interrupted or KEEP_QA_DATA=1 run (registry reset before they were
  // cleaned) still get removed.
  const ids = new Set((reg.users ?? []).map((u) => u.userId));
  const { data: taggedProfiles } = await supabaseAdmin.from("profiles").select("id").ilike("full_name", "QA_%");
  for (const p of taggedProfiles ?? []) ids.add(p.id);

  for (const userId of ids) {
    const { data: providers } = await supabaseAdmin.from("providers").select("id").eq("profile_id", userId);
    for (const provider of providers ?? []) {
      await supabaseAdmin.from("availability_rules").delete().eq("provider_id", provider.id);
      await supabaseAdmin.from("provider_services").delete().eq("provider_id", provider.id);
    }
    await supabaseAdmin.from("providers").delete().eq("profile_id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: profileDeleteError } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
    if (profileDeleteError) {
      await supabaseAdmin.from("profiles").update({ is_suspended: true }).eq("id", userId);
      await supabaseAdmin.from("providers").update({ is_active: false, is_verified: false }).eq("profile_id", userId);
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
        password: crypto.randomBytes(48).toString("base64url"),
      });
    } else {
      await disableOrDeleteQaIdentity(userId);
    }
  }

  for (const userId of ids) {
    await assertQaIdentityDisabled(userId);
  }

  const [{ data: activeZones }, { data: activeServices }, { data: activeMethods }, { data: activeCampaigns }, { data: activeBookings }] = await Promise.all([
    supabaseAdmin.from("zones").select("id").ilike("name_en", "QA_%").eq("is_active", true),
    supabaseAdmin.from("services").select("id").ilike("name_en", "QA_%").eq("is_active", true),
    supabaseAdmin.from("payment_methods").select("id").ilike("name_en", "QA_%").or("is_active.eq.true,is_default.eq.true"),
    supabaseAdmin.from("notification_campaigns").select("id").ilike("title_en", "QA_%").in("status", ["draft", "scheduled", "sending"]),
    supabaseAdmin.from("bookings").select("id").ilike("notes", "QA_%").in("status", ["pending", "confirmed", "in_progress"]),
  ]);
  if (activeZones?.length || activeServices?.length || activeMethods?.length || activeCampaigns?.length || activeBookings?.length) {
    throw new Error("[qa-teardown] active or globally influential QA records remain.");
  }
  await restorePendingRestorations();
  assertNoPendingRestorations();

  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  const { data: retainedProfiles } = await supabaseAdmin.from("profiles").select("id,full_name,is_suspended").ilike("full_name", "QA_%");
  const retained = (retainedProfiles ?? []).map((profile) => ({
    id: profile.id,
    full_name: profile.full_name,
    reason: "FK-bound or auth-delete-failed QA profile retained suspended/neutralized",
  }));
  fs.writeFileSync(path.join(reportDir, "residue.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    retained_profiles: retained,
    retained_count: retained.length,
  }, null, 2));

  console.log(`[qa-teardown] removed or disabled ${ids.size} QA users and tagged rows.`);
  if (retained.length) {
    console.log(`[qa-teardown] retained ${retained.length} FK-bound QA profile(s); see qa/report/residue.json`);
  }
  writeRegistry({ users: [] });
}
