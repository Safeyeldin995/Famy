import { isDestructiveCleanupEligible } from "./qa-classification.mjs";
import { maskUserId } from "./qa-classification.mjs";

/**
 * Already-contained identities are excluded from containment planning/execute.
 * @param {{ authBanned: boolean; profileSuspended: boolean; hasAdminRole: boolean }} state
 */
export function isIdentityAlreadyContained(state) {
  return state.authBanned && state.profileSuspended && !state.hasAdminRole;
}

/**
 * @param {{
 *   userId: string;
 *   email?: string | null;
 *   fullName?: string | null;
 *   authBanned: boolean;
 *   profileSuspended: boolean;
 *   hasAdminRole: boolean;
 *   inRegistry?: boolean;
 * }} state
 */
export function identityNeedsContainment(state) {
  const qaEligible = isDestructiveCleanupEligible({
    email: state.email ?? null,
    fullName: state.fullName ?? null,
    inRegistry: state.inRegistry ?? false,
  }, { ignoreRegistry: Boolean(state.inRegistry) });

  if (!qaEligible) return false;
  if (isIdentityAlreadyContained(state)) return false;
  return !state.authBanned || !state.profileSuspended || state.hasAdminRole;
}

/**
 * @param {{
 *   userId: string;
 *   authBanned: boolean;
 *   profileSuspended: boolean;
 *   hasAdminRole: boolean;
 * }} state
 */
export function planIdentityContainmentActions(state) {
  /** @type {Array<{ actionType: string; field: string; from: unknown; to: unknown }>} */
  const actions = [];

  if (!state.authBanned) {
    actions.push({ actionType: "ban_auth", field: "auth.banned_until", from: false, to: true });
  }
  if (!state.profileSuspended) {
    actions.push({ actionType: "suspend_profile", field: "profiles.is_suspended", from: false, to: true });
  }
  if (state.hasAdminRole) {
    actions.push({ actionType: "remove_admin_role", field: "user_roles.admin", from: true, to: false });
  }

  return {
    entityType: "identity",
    id: state.userId,
    maskedId: maskUserId(state.userId),
    actions,
    preservesRows: true,
    sessionRevocation: "unverified",
  };
}

/**
 * @param {unknown} bannedUntil
 * @param {unknown} banDuration
 */
export function isAuthBanned(bannedUntil, banDuration) {
  const parsed = bannedUntil ? Date.parse(String(bannedUntil)) : NaN;
  if (Number.isFinite(parsed) && parsed > Date.now()) return true;
  return typeof banDuration === "string" && banDuration.length > 0;
}
