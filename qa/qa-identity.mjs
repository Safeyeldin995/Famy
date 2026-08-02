// Authoritative non-secret Famy project identity anchors for QA guardrails.

/** @type {const} */
export const KNOWN_QA_PROJECT_REF = "bfwveoqbyqlhixjvdzha";
/** @type {const} */
export const KNOWN_PRODUCTION_PROJECT_REF = "mjhkaiabfnzewprcnojp";

const SUPABASE_HOST_RE = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i;

/**
 * @param {string | undefined} url
 * @returns {string}
 */
export function parseSupabaseProjectRef(url) {
  if (!url || typeof url !== "string") {
    throw new Error("[qa-identity] Supabase URL is missing or invalid.");
  }
  const trimmed = url.trim();
  const match = trimmed.match(SUPABASE_HOST_RE);
  if (!match?.[1]) {
    throw new Error("[qa-identity] Supabase URL must be https://<project-ref>.supabase.co");
  }
  return match[1];
}

/**
 * @param {string} ref
 */
export function environmentLabelForProjectRef(ref) {
  if (ref === KNOWN_QA_PROJECT_REF) return "qa";
  if (ref === KNOWN_PRODUCTION_PROJECT_REF) return "production";
  return "unknown";
}
