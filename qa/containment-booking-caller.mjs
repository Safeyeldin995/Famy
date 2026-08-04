import { createClient } from "@supabase/supabase-js";
import { maskUserId } from "./qa-classification.mjs";
import { identityNeedsContainment } from "./containment-identity.mjs";

export const BOOKING_CALLER_CLASS = "authenticated_qa_admin";
export const CALLER_AUTH_MODE = "admin_generated_magiclink";

/**
 * Select exactly one QA admin caller from identities included in the containment plan.
 * @param {Array<{
 *   userId: string;
 *   email?: string | null;
 *   fullName?: string | null;
 *   authBanned: boolean;
 *   profileSuspended: boolean;
 *   hasAdminRole: boolean;
 *   inRegistry?: boolean;
 * }>} identities
 * @param {boolean} requiresBookingCaller
 */
export function selectBookingCaller(identities, requiresBookingCaller) {
  if (!requiresBookingCaller) {
    return { ok: true, caller: null };
  }

  const eligible = (identities ?? []).filter((identity) => {
    if (!identityNeedsContainment(identity)) return false;
    if (!identity.hasAdminRole) return false;
    if (identity.authBanned) return false;
    if (identity.profileSuspended) return false;
    return true;
  });

  if (eligible.length === 0) {
    return {
      ok: false,
      blocked: {
        reason: "zero-booking-callers",
        detail: "no eligible QA admin in containment plan",
      },
    };
  }

  if (eligible.length > 1) {
    return {
      ok: false,
      blocked: {
        reason: "multiple-booking-callers",
        detail: `eligible_count=${eligible.length}`,
      },
    };
  }

  const selected = eligible[0];
  return {
    ok: true,
    caller: {
      userId: selected.userId,
      maskedId: maskUserId(selected.userId),
      callerClass: BOOKING_CALLER_CLASS,
    },
  };
}

/**
 * @param {{ userId: string; maskedId: string; callerClass: string } | null | undefined} caller
 */
export function sanitizeBookingCallerForReport(caller) {
  if (!caller) return null;
  return {
    maskedId: caller.maskedId,
    callerClass: caller.callerClass,
  };
}

/**
 * @param {unknown} linkData
 */
export function extractHashedTokenFromGenerateLink(linkData) {
  const hashed = linkData?.properties?.hashed_token;
  return typeof hashed === "string" && hashed.length > 0 ? hashed : null;
}

/**
 * Authenticate the planned QA admin caller at execute time via admin generateLink + verifyOtp.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} expectedCallerUserId
 * @param {{
 *   generateLink?: (email: string) => Promise<{ data: unknown; error: Error | null }>;
 *   verifyOtp?: (client: import('@supabase/supabase-js').SupabaseClient, tokenHash: string) => Promise<{ data: unknown; error: Error | null }>;
 *   createPublishableClient?: (url: string, key: string, options?: object) => import('@supabase/supabase-js').SupabaseClient;
 *   supabaseUrl?: string;
 *   publishableKey?: string;
 * }} [deps]
 */
export async function authenticateBookingCaller(admin, expectedCallerUserId, deps = {}) {
  const supabaseUrl = deps.supabaseUrl ?? process.env.QA_SUPABASE_URL;
  const publishableKey = deps.publishableKey ?? process.env.QA_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, reason: "missing-qa-publishable-config", mutationsAllowed: false };
  }

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(expectedCallerUserId);
  if (authError || !authData?.user?.email) {
    return { ok: false, reason: "caller-email-unavailable", mutationsAllowed: false };
  }

  const email = authData.user.email;
  const generateLink = deps.generateLink
    ?? (async (callerEmail) => admin.auth.admin.generateLink({ type: "magiclink", email: callerEmail }));
  const { data: linkData, error: linkError } = await generateLink(email);
  const hashedToken = extractHashedTokenFromGenerateLink(linkData);
  if (linkError || !hashedToken) {
    return { ok: false, reason: "caller-magiclink-generation-failed", mutationsAllowed: false };
  }

  const createClientFn = deps.createPublishableClient
    ?? ((url, key, options = {}) => createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      ...options,
    }));

  const verifyClient = createClientFn(supabaseUrl, publishableKey);
  const verifyOtp = deps.verifyOtp
    ?? (async (client, tokenHash) => client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }));
  const { data: verifyData, error: verifyError } = await verifyOtp(verifyClient, hashedToken);
  const session = verifyData?.session;
  const user = verifyData?.user;
  if (verifyError || !session?.access_token || !user?.id) {
    return { ok: false, reason: "caller-magiclink-verification-failed", mutationsAllowed: false };
  }

  if (user.id !== expectedCallerUserId) {
    return { ok: false, reason: "caller-user-id-mismatch", mutationsAllowed: false };
  }

  const [{ data: roles, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", expectedCallerUserId).eq("role", "admin"),
    admin.from("profiles").select("is_suspended").eq("id", expectedCallerUserId).maybeSingle(),
  ]);

  if (roleError || profileError) {
    return { ok: false, reason: "caller-verification-read-failed", mutationsAllowed: false };
  }
  if (!(roles ?? []).length) {
    return { ok: false, reason: "caller-missing-admin-role", mutationsAllowed: false };
  }
  if (profile?.is_suspended === true) {
    return { ok: false, reason: "caller-profile-suspended", mutationsAllowed: false };
  }
  if (authData.user.banned_until && Date.parse(String(authData.user.banned_until)) > Date.now()) {
    return { ok: false, reason: "caller-auth-banned", mutationsAllowed: false };
  }

  const accessToken = session.access_token;
  const rpcClient = createClientFn(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    ok: true,
    mutationsAllowed: true,
    rpcClient,
    accessToken,
    callerAuthMode: CALLER_AUTH_MODE,
  };
}

/**
 * Revoke the temporary authenticated session using admin.signOut(jwt, scope).
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} accessToken
 */
export async function revokeBookingCallerSession(admin, accessToken) {
  if (!accessToken) {
    return { ok: false, reason: "missing-access-token" };
  }
  const { error } = await admin.auth.admin.signOut(accessToken, "global");
  if (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} bookingId
 */
export async function verifyBookingCancelled(admin, bookingId) {
  const [{ data: booking, error: bookingError }, { data: cancellation, error: cancellationError }] = await Promise.all([
    admin.from("bookings").select("status").eq("id", bookingId).maybeSingle(),
    admin.from("booking_cancellations").select("booking_id").eq("booking_id", bookingId).maybeSingle(),
  ]);
  if (bookingError || cancellationError) {
    return { ok: false, reason: "verification-read-failed" };
  }
  if (booking?.status !== "cancelled" || !cancellation?.booking_id) {
    return { ok: false, reason: "booking-not-terminal" };
  }
  return { ok: true };
}
