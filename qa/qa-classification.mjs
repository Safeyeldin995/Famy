// Deterministic QA user classification — multiple signals required for destructive cleanup.

/** @typedef {{ email?: string | null; fullName?: string | null; inRegistry?: boolean }} QaUserSignals */

export const QA_DETERMINISTIC_EMAIL_RE = /^qa-.*@famio\.local$/i;
export const FAMIO_LOCAL_EMAIL_RE = /@famio\.local$/i;
export const PHONE_FAMIO_EMAIL_RE = /^phone-.*@famio\.local$/i;

/** Matches PostgreSQL ILIKE 'QA_%' and real fixtures like "QA Booking Provider". */
export const QA_PROFILE_NAME_RE = /^QA./i;

/**
 * @param {string | null | undefined} fullName
 */
export function isQaProfileName(fullName) {
  return typeof fullName === "string" && QA_PROFILE_NAME_RE.test(fullName);
}

/**
 * @param {string | null | undefined} email
 */
export function isDeterministicQaEmail(email) {
  return typeof email === "string" && QA_DETERMINISTIC_EMAIL_RE.test(email);
}

/**
 * Non-destructive classification for candidate discovery.
 * Registry membership alone is never sufficient.
 * @param {QaUserSignals} signals
 */
export function isHighConfidenceQaUser(signals) {
  return isDestructiveCleanupEligible(signals);
}

/**
 * Final destructive cleanup gate — registry alone is never sufficient.
 * @param {QaUserSignals} signals
 * @param {{ ignoreRegistry?: boolean }} [options]
 */
export function isDestructiveCleanupEligible(signals, options = {}) {
  if (isDeterministicQaEmail(signals.email)) return true;

  const registryOk = signals.inRegistry || options.ignoreRegistry;

  if (
    registryOk
    && isQaProfileName(signals.fullName)
    && signals.email
    && PHONE_FAMIO_EMAIL_RE.test(signals.email)
  ) {
    return true;
  }

  if (
    registryOk
    && isQaProfileName(signals.fullName)
    && signals.email
    && FAMIO_LOCAL_EMAIL_RE.test(signals.email)
    && !PHONE_FAMIO_EMAIL_RE.test(signals.email)
  ) {
    return true;
  }

  return false;
}

/**
 * @param {string | null | undefined} userId
 */
export function maskUserId(userId) {
  if (!userId || userId.length < 12) return "****";
  return `${userId.slice(0, 4)}…${userId.slice(-4)}`;
}
