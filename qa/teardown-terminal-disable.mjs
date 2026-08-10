import { randomBytes } from "node:crypto";
import { formatTeardownError, logTeardownError } from "./teardown-errors.mjs";
import { isDestructiveCleanupEligible } from "./qa-classification.mjs";
import { TERMINAL_DISABLED_LABELS } from "./teardown-verification.mjs";

/** ~100 years — canonical long ban for QA terminal disable. */
export const TERMINAL_BAN_DURATION = "876000h";

/** @supabase/auth-js admin.signOut(jwt, scope) requires an access token JWT — not a user id. */
export const SIGNOUT_API_REQUIRES_JWT = true;

/**
 * @returns {string}
 */
export function generateSecureRandomPassword() {
  return randomBytes(32).toString("base64url");
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function attemptAuthHardDelete(admin, userId) {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error && error.message !== "User not found") {
    const entry = formatTeardownError({
      operation: "auth.deleteUser",
      entityType: "auth.users",
      id: userId,
      error,
    });
    logTeardownError(entry);
    return { ok: false, error: entry };
  }
  return { ok: true, error: null };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function deleteProfileRow(admin, userId) {
  const { error } = await admin.from("profiles").delete().eq("id", userId);
  if (error) {
    const entry = formatTeardownError({
      operation: "delete",
      table: "profiles",
      id: userId,
      error,
    });
    logTeardownError(entry);
    return { ok: false, error: entry };
  }
  return { ok: true, error: null };
}

/**
 * Attempt global session revocation using the installed Admin API.
 * The supported signature is signOut(jwt, scope) — there is no userId-based global revoke.
 * @param {import('@supabase/supabase-js').SupabaseClient} _admin
 * @param {string} userId
 */
export async function attemptGlobalSessionRevocation(_admin, userId) {
  if (SIGNOUT_API_REQUIRES_JWT) {
    return {
      attempted: false,
      verified: false,
      reason: "no-supported-userid-global-signout",
      userId,
    };
  }
  return { attempted: false, verified: false, reason: "signout-unavailable", userId };
}

/**
 * Disable auth identity via canonical Admin API — ban and password rotation.
 * Session revocation is reported separately; ban success does not imply revoked sessions.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function disableAuthIdentity(admin, userId) {
  const password = generateSecureRandomPassword();
  /** @type {Array<ReturnType<typeof formatTeardownError>>} */
  const errors = [];

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: TERMINAL_BAN_DURATION,
    password,
  });
  if (updateError) {
    const entry = formatTeardownError({
      operation: "auth.updateUserById",
      entityType: "auth.users",
      id: userId,
      error: updateError,
    });
    errors.push(entry);
    logTeardownError(entry);
    return { ok: false, banOk: false, sessionVerified: false, password, errors };
  }

  const authCheck = await verifyAuthDisabled(admin, userId);
  if (!authCheck.disabled) {
    const entry = formatTeardownError({
      operation: "auth.verifyBanned",
      entityType: "auth.users",
      id: userId,
      error: { message: authCheck.reason },
    });
    errors.push(entry);
    return { ok: false, banOk: false, sessionVerified: false, password, errors, reason: `disable-verify-failed:${authCheck.reason}` };
  }

  const session = await attemptGlobalSessionRevocation(admin, userId);
  return {
    ok: true,
    banOk: true,
    sessionVerified: session.verified,
    sessionReason: session.reason,
    password,
    errors,
  };
}

/**
 * Fresh Admin read verifying the account is genuinely banned/disabled.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function verifyAuthDisabled(admin, userId) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    return { disabled: false, reason: "missing-auth-user" };
  }

  const user = data.user;
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : NaN;
  if (Number.isFinite(bannedUntil) && bannedUntil > Date.now()) {
    return { disabled: true, reason: "banned_until" };
  }

  if (typeof user.ban_duration === "string" && user.ban_duration.length > 0) {
    return { disabled: true, reason: "ban_duration" };
  }

  return { disabled: false, reason: "not-banned" };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function suspendQaProfile(admin, userId) {
  const { error } = await admin.from("profiles").update({ is_suspended: true }).eq("id", userId);
  if (error) {
    const entry = formatTeardownError({
      operation: "update",
      table: "profiles",
      id: userId,
      error,
    });
    logTeardownError(entry);
    return { ok: false, error: entry };
  }
  return { ok: true, error: null };
}

/**
 * Remove privileged admin role only — preserve other roles for classification context.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function removePrivilegedAdminRole(admin, userId) {
  const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
  if (error) {
    const entry = formatTeardownError({
      operation: "delete",
      table: "user_roles",
      id: userId,
      error,
    });
    logTeardownError(entry);
    return { ok: false, error: entry };
  }
  return { ok: true, error: null };
}

/**
 * Fresh read verifying the privileged admin role was removed.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function verifyNoPrivilegedAdminRole(admin, userId) {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    return { ok: false, reason: "admin-role-verify-error" };
  }
  if ((data ?? []).some((row) => row.role === "admin")) {
    return { ok: false, reason: "admin-role-still-present" };
  }
  return { ok: true, reason: "no-admin-role" };
}

/**
 * Verify profile suspension using canonical multi-signal QA classification.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
export async function verifyProfileSuspendedQaEvidence(admin, userId) {
  const [{ data: authData }, { data: profile, error }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name,is_suspended").eq("id", userId).maybeSingle(),
  ]);
  if (error || !profile) {
    return { ok: false, reason: "missing-profile" };
  }
  if (!profile.is_suspended) {
    return { ok: false, reason: "not-suspended" };
  }
  const email = authData?.user?.email ?? null;
  if (!isDestructiveCleanupEligible(
    { email, fullName: profile.full_name, inRegistry: false },
    { ignoreRegistry: true },
  )) {
    return { ok: false, reason: "missing-qa-classification-evidence" };
  }
  return { ok: true, reason: "suspended-qa-profile" };
}

/**
 * @param {string[]} remainingLabels
 */
export function remainingIndicatesTerminalBlock(remainingLabels) {
  return remainingLabels.some((label) => TERMINAL_DISABLED_LABELS.has(label))
    || remainingLabels.some((label) => label.includes("ticket_messages") || label === "support_tickets");
}

/**
 * Full terminal-disable sequence after safe data cleanup and failed auth hard-delete.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {{ blockers: string[] }} params
 */
export async function executeTerminalDisable(admin, userId, params) {
  const disable = await disableAuthIdentity(admin, userId);
  if (!disable.ok || !disable.banOk) {
    return {
      ok: false,
      verified: false,
      outcome: "disable_failed",
      reason: disable.reason ?? "disable-api-failed",
      errors: disable.errors,
      sessionVerified: false,
    };
  }

  const suspend = await suspendQaProfile(admin, userId);
  if (!suspend.ok) {
    return {
      ok: false,
      verified: false,
      outcome: "disable_failed",
      reason: "profile-suspend-failed",
      errors: [suspend.error],
      sessionVerified: disable.sessionVerified,
    };
  }

  const adminRoleRemoval = await removePrivilegedAdminRole(admin, userId);
  if (!adminRoleRemoval.ok) {
    return {
      ok: false,
      verified: false,
      outcome: "disable_failed",
      reason: "admin-role-removal-failed",
      errors: [adminRoleRemoval.error],
      sessionVerified: disable.sessionVerified,
    };
  }

  const adminRoleCheck = await verifyNoPrivilegedAdminRole(admin, userId);
  if (!adminRoleCheck.ok) {
    return {
      ok: false,
      verified: false,
      outcome: "disable_failed",
      reason: `admin-role-removal-failed:${adminRoleCheck.reason}`,
      errors: [],
      sessionVerified: disable.sessionVerified,
    };
  }

  const profileCheck = await verifyProfileSuspendedQaEvidence(admin, userId);
  if (!profileCheck.ok) {
    return {
      ok: false,
      verified: false,
      outcome: "disable_failed",
      reason: `profile-verify-failed:${profileCheck.reason}`,
      errors: [],
      sessionVerified: disable.sessionVerified,
    };
  }

  const outcome = disable.sessionVerified
    ? "terminal_disabled_verified"
    : "terminal_disabled_session_unverified";

  return {
    ok: true,
    verified: disable.sessionVerified,
    outcome,
    reason: `${outcome}:${params.blockers.join(",")}`,
    errors: disable.errors,
    sessionVerified: disable.sessionVerified,
    sessionReason: disable.sessionReason,
  };
}
