import { getSupabaseAdmin } from "./admin-client.mjs";
import { readRegistry, writeRegistry } from "./registry.mjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assertNoPendingRestorations, restorePendingRestorations } from "./restoration-registry.mjs";
import { assertQaWriteGuard } from "./env-guard.mjs";
import { loadQaEnv } from "./load-qa-env.mjs";
import {
  isDestructiveCleanupEligible,
  isDeterministicQaEmail,
  maskUserId,
} from "./qa-classification.mjs";
import { listAllAuthUsers } from "./list-users-paginated.mjs";

const QA_TAGGED_TABLES = [
  { table: "services", column: "name_en" },
  { table: "promo_codes", column: "code" },
  { table: "zones", column: "name_en" },
  { table: "notification_campaigns", column: "title_en" },
  { table: "payment_methods", column: "name_en" },
  { table: "cancellation_reasons", column: "name_en" },
  { table: "bookings", column: "notes" },
];

function guardBeforeWrite() {
  loadQaEnv({ required: true });
  assertQaWriteGuard(process.env);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {Set<string>} registryIds
 */
export async function assessDestructiveCleanupEligibility(admin, userId, registryIds) {
  const inRegistry = registryIds.has(userId);
  const [{ data: authData }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);

  const email = authData.user?.email ?? null;
  const fullName = profile?.full_name ?? null;

  if (!authData.user) {
    return { eligible: false, reason: "missing-auth-user", email, fullName, inRegistry };
  }

  const eligible = isDestructiveCleanupEligible({ email, fullName, inRegistry });
  return {
    eligible,
    reason: eligible ? "eligible" : "insufficient-qa-signals",
    email,
    fullName,
    inRegistry,
  };
}

async function assertQaIdentityDisabled(admin, userId) {
  const [{ data: authData, error: authError }, profile, roles, provider] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("id,is_suspended").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("user_id").eq("user_id", userId),
    admin.from("providers").select("id,is_active,is_verified").eq("profile_id", userId),
  ]);

  if ((profile.data && !profile.data.is_suspended) || (roles.data?.length ?? 0) > 0 || (provider.data?.some((p) => p.is_active || p.is_verified) ?? false)) {
    throw new Error(`[qa-teardown] QA identity ${maskUserId(userId)} still has an active profile, role, or provider record.`);
  }

  if (!authError && authData.user && !authData.user.deleted_at && !authData.user.banned_until) {
    throw new Error(`[qa-teardown] QA auth identity ${maskUserId(userId)} remains active after cleanup.`);
  }
}

async function disableOrDeleteQaIdentity(admin, userId) {
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (!deleteError || deleteError.message === "User not found") return;

  console.error(`[qa-teardown] hard deleteUser ${maskUserId(userId)} failed:`, deleteError.message || deleteError);

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
    password: crypto.randomBytes(48).toString("base64url"),
  });
  if (banError && banError.message !== "User not found") {
    console.error(`[qa-teardown] disabling QA identity ${maskUserId(userId)} failed:`, banError.message || banError);
  }

  const { error: softDeleteError } = await admin.auth.admin.deleteUser(userId, true);
  if (softDeleteError && softDeleteError.message !== "User not found") {
    console.error(`[qa-teardown] soft deleteUser ${maskUserId(userId)} failed:`, softDeleteError.message || softDeleteError);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function collectQaCandidateUserIds(admin) {
  const reg = readRegistry();
  const registryIds = new Set((reg.users ?? []).map((u) => u.userId).filter(Boolean));
  const ids = new Set();

  const deterministicAuthUsers = await listAllAuthUsers(admin, (user) => isDeterministicQaEmail(user.email));
  for (const user of deterministicAuthUsers) ids.add(user.id);

  const { data: taggedProfiles } = await admin.from("profiles").select("id,full_name").ilike("full_name", "QA_%");
  for (const profile of taggedProfiles ?? []) {
    const assessment = await assessDestructiveCleanupEligibility(admin, profile.id, registryIds);
    if (assessment.eligible) ids.add(profile.id);
  }

  for (const userId of registryIds) {
    const assessment = await assessDestructiveCleanupEligibility(admin, userId, registryIds);
    if (assessment.eligible) ids.add(userId);
  }

  return { ids: [...ids], registryIds: [...registryIds] };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} userIds
 * @param {{ execute?: boolean; registryIds?: string[] }} [options]
 */
export async function runTeardownForUserIds(admin, userIds, options = {}) {
  const execute = options.execute ?? true;
  const registryIds = new Set(
    options.registryIds ?? (readRegistry().users ?? []).map((u) => u.userId).filter(Boolean),
  );
  const succeeded = [];
  const refused = [];

  for (const userId of userIds) {
    const assessment = await assessDestructiveCleanupEligibility(admin, userId, registryIds);
    if (!assessment.eligible) {
      refused.push({ userId, reason: assessment.reason });
      continue;
    }

    if (!execute) {
      succeeded.push(userId);
      continue;
    }

    const { data: providers } = await admin.from("providers").select("id").eq("profile_id", userId);
    for (const provider of providers ?? []) {
      await admin.from("availability_rules").delete().eq("provider_id", provider.id);
      await admin.from("provider_services").delete().eq("provider_id", provider.id);
    }
    await admin.from("providers").delete().eq("profile_id", userId);
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: profileDeleteError } = await admin.from("profiles").delete().eq("id", userId);
    if (profileDeleteError) {
      await admin.from("profiles").update({ is_suspended: true }).eq("id", userId);
      await admin.from("providers").update({ is_active: false, is_verified: false }).eq("profile_id", userId);
      await admin.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
        password: crypto.randomBytes(48).toString("base64url"),
      });
    } else {
      await disableOrDeleteQaIdentity(admin, userId);
    }
    await assertQaIdentityDisabled(admin, userId);
    succeeded.push(userId);
  }

  return {
    userCount: succeeded.length,
    maskedIds: succeeded.map(maskUserId),
    succeeded,
    refused,
  };
}

export async function runTeardownDryRun() {
  guardBeforeWrite();
  const admin = getSupabaseAdmin();
  const { ids } = await collectQaCandidateUserIds(admin);
  const taggedCounts = await Promise.all(
    QA_TAGGED_TABLES.map(async ({ table, column }) => {
      const { count } = await admin.from(table).select("id", { count: "exact", head: true }).ilike(column, "QA_%");
      return { table, count: count ?? 0 };
    }),
  );

  console.log("[qa-cleanup:dry-run] No data was modified.");
  console.log(`[qa-cleanup:dry-run] candidate_users=${ids.length}`);
  console.log(`[qa-cleanup:dry-run] masked_user_ids=${ids.map(maskUserId).join(", ") || "(none)"}`);
  for (const row of taggedCounts) {
    console.log(`[qa-cleanup:dry-run] qa_tagged_${row.table}=${row.count}`);
  }
  return { candidateUserCount: ids.length, maskedUserIds: ids.map(maskUserId), taggedCounts };
}

export async function runTeardown() {
  guardBeforeWrite();
  const admin = getSupabaseAdmin();
  await restorePendingRestorations();
  const { ids } = await collectQaCandidateUserIds(admin);

  const { error: neutralizeBookingsError } = await admin
    .from("bookings")
    .update({ status: "cancelled", cancellation_reason: "QA_ teardown recovery" })
    .ilike("notes", "QA_%")
    .in("status", ["pending", "confirmed", "in_progress"]);
  if (neutralizeBookingsError) throw new Error(`[qa-teardown] could not neutralize active QA bookings: ${neutralizeBookingsError.message}`);

  const { data: qaZones } = await admin.from("zones").select("id").ilike("name_en", "QA_%");
  for (const zone of qaZones ?? []) {
    await admin.from("zone_providers").delete().eq("zone_id", zone.id);
    await admin.from("zone_services").delete().eq("zone_id", zone.id);
  }

  for (const { table, column } of QA_TAGGED_TABLES) {
    const { error } = await admin.from(table).delete().ilike(column, "QA_%");
    if (error && table === "zones") {
      await admin.from("zones").update({ is_active: false }).ilike("name_en", "QA_%");
    } else if (error && table === "services") {
      const { error: neutralizeServiceError } = await admin.from("services").update({ is_active: false }).ilike("name_en", "QA_%");
      if (neutralizeServiceError) throw new Error(`[qa-teardown] could not neutralize QA services: ${neutralizeServiceError.message}`);
    } else if (error && table !== "bookings") {
      console.error(`[qa-teardown] ${table} cleanup error:`, error.message);
    }
  }

  await runTeardownForUserIds(admin, ids, { execute: true });

  const [{ data: activeZones }, { data: activeServices }, { data: activeMethods }, { data: activeCampaigns }, { data: activeBookings }] = await Promise.all([
    admin.from("zones").select("id").ilike("name_en", "QA_%").eq("is_active", true),
    admin.from("services").select("id").ilike("name_en", "QA_%").eq("is_active", true),
    admin.from("payment_methods").select("id").ilike("name_en", "QA_%").or("is_active.eq.true,is_default.eq.true"),
    admin.from("notification_campaigns").select("id").ilike("title_en", "QA_%").in("status", ["draft", "scheduled", "sending"]),
    admin.from("bookings").select("id").ilike("notes", "QA_%").in("status", ["pending", "confirmed", "in_progress"]),
  ]);
  if (activeZones?.length || activeServices?.length || activeMethods?.length || activeCampaigns?.length || activeBookings?.length) {
    throw new Error("[qa-teardown] active or globally influential QA records remain.");
  }
  await restorePendingRestorations();
  assertNoPendingRestorations();

  const reportDir = path.resolve(process.cwd(), "qa/report");
  fs.mkdirSync(reportDir, { recursive: true });
  const { data: retainedProfiles } = await admin.from("profiles").select("id,full_name,is_suspended").ilike("full_name", "QA_%");
  const retained = (retainedProfiles ?? []).map((profile) => ({
    id: maskUserId(profile.id),
    full_name: profile.full_name,
    reason: "FK-bound or auth-delete-failed QA profile retained suspended/neutralized",
  }));
  fs.writeFileSync(path.join(reportDir, "residue.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    retained_profiles: retained,
    retained_count: retained.length,
  }, null, 2));

  console.log(`[qa-teardown] removed or disabled ${ids.length} QA users and tagged rows.`);
  if (retained.length) {
    console.log(`[qa-teardown] retained ${retained.length} FK-bound QA profile(s); see qa/report/residue.json`);
  }
  writeRegistry({ users: [] });
}
