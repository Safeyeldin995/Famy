#!/usr/bin/env node
/**
 * Read-only Phase 1 live-state verification for affected QA users.
 * Never mutates remote state.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadQaEnv } from "./load-qa-env.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { maskUserId, isDestructiveCleanupEligible } from "./qa-classification.mjs";
import { readRegistry } from "./registry.mjs";
import { summarizeRecoveryJournal } from "./teardown-recovery-classify.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";

/**
 * Resolve full user IDs from residue masked IDs using registry + recovery journal.
 * @param {string[]} maskedIds
 */
function resolveUserIdsFromResidue(maskedIds) {
  const registryIds = (readRegistry().users ?? []).map((row) => row.userId).filter(Boolean);
  const recovery = summarizeRecoveryJournal();
  const recoveryPath = recovery.path;
  const lines = fs.existsSync(recoveryPath)
    ? fs.readFileSync(recoveryPath, "utf8").split("\n").filter(Boolean)
    : [];
  /** @type {Set<string>} */
  const candidateIds = new Set(registryIds);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.kind === "user" && entry.id) candidateIds.add(entry.id);
    } catch {
      // ignore
    }
  }

  return maskedIds.map((masked) => {
    const match = [...candidateIds].find((id) => maskUserId(id) === masked);
    return match ?? null;
  }).filter(Boolean);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
async function verifyUserLiveState(admin, userId) {
  const [{ data: authData }, { data: profile }, { data: roles }, { data: providers }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name,is_suspended").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("providers").select("id").eq("profile_id", userId),
  ]);

  const providerIds = (providers ?? []).map((row) => row.id);
  let ownedBookings = 0;
  if (providerIds.length) {
    const { count: providerBookings } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("provider_id", providerIds);
    ownedBookings += providerBookings ?? 0;
  }
  const { count: customerBookings } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", userId);
  ownedBookings += customerBookings ?? 0;

  const registryIds = new Set((readRegistry().users ?? []).map((row) => row.userId));
  const recovery = summarizeRecoveryJournal();
  const recoveryEntries = readRecoveryLines(recovery.path).filter((entry) => entry.id === userId);

  const authUser = authData?.user ?? null;
  const bannedUntil = authUser?.banned_until ? Date.parse(authUser.banned_until) : NaN;
  const email = authUser?.email ?? null;
  const fullName = profile?.full_name ?? null;

  return {
    maskedId: maskUserId(userId),
    authExists: Boolean(authUser && !authUser.deleted_at),
    bannedUntilFuture: Number.isFinite(bannedUntil) && bannedUntil > Date.now(),
    profileExists: Boolean(profile),
    isSuspended: profile?.is_suspended === true,
    qaClassificationEligible: isDestructiveCleanupEligible({
      email,
      fullName,
      inRegistry: registryIds.has(userId),
    }),
    adminRole: (roles ?? []).some((row) => row.role === "admin"),
    otherRoles: [...new Set((roles ?? []).map((row) => row.role).filter((role) => role !== "admin"))],
    providerExists: providerIds.length > 0,
    ownedBookingCount: ownedBookings,
    registryMember: registryIds.has(userId),
    recoveryJournalEntries: recoveryEntries.length,
  };
}

/**
 * @param {string} recoveryPath
 */
function readRecoveryLines(recoveryPath) {
  if (!fs.existsSync(recoveryPath)) return [];
  return fs.readFileSync(recoveryPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { id: line, kind: "parse-error" };
      }
    });
}

export async function main() {
  loadQaEnv({ required: true });
  const admin = getSupabaseAdmin();

  const residuePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "report/residue.json");
  const residue = JSON.parse(fs.readFileSync(residuePath, "utf8"));
  const maskedIds = (residue.failed_users ?? []).map((row) => row.id);
  const userIds = resolveUserIdsFromResidue(maskedIds);

  if (userIds.length !== maskedIds.length) {
    console.error("[phase1-live-verify] Could not resolve all masked user IDs from registry/recovery.");
    return 1;
  }

  const results = [];
  for (const userId of userIds) {
    results.push(await verifyUserLiveState(admin, userId));
  }

  console.log(JSON.stringify({ users: results }, null, 2));
  return 0;
}

runCliIfDirect(import.meta.url, () => main());
