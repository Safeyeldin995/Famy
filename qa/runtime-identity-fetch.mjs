import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
} from "./qa-identity.mjs";
import { QA_META_PATH } from "./runtime-identity-build.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";

/**
 * @typedef {{ environment: string; supabaseProjectRef: string }} RuntimeIdentityPayload
 */

/**
 * @param {unknown} body
 * @returns {RuntimeIdentityPayload}
 */
export function validateRuntimeIdentityPayload(body) {
  if (!body || typeof body !== "object") {
    throw new Error("[qa-runtime-identity] Response is not a JSON object.");
  }
  const record = /** @type {Record<string, unknown>} */ (body);
  if (typeof record.environment !== "string" || !record.environment.trim()) {
    throw new Error("[qa-runtime-identity] Missing environment field.");
  }
  if (typeof record.supabaseProjectRef !== "string" || !record.supabaseProjectRef.trim()) {
    throw new Error("[qa-runtime-identity] Missing supabaseProjectRef field.");
  }
  const supabaseProjectRef = record.supabaseProjectRef.trim();
  parseSupabaseProjectRef(`https://${supabaseProjectRef}.supabase.co`);
  return { environment: record.environment.trim(), supabaseProjectRef };
}

/**
 * @param {RuntimeIdentityPayload} payload
 * @param {string} expectedNodeRef
 */
export function assertRuntimeIdentityMatchesQaGuard(payload, expectedNodeRef) {
  if (payload.environment !== "qa") {
    throw new Error(`[qa-runtime-identity] Deployed environment must be "qa", got "${payload.environment}".`);
  }
  if (payload.supabaseProjectRef !== KNOWN_QA_PROJECT_REF) {
    throw new Error("[qa-runtime-identity] Deployed Supabase ref does not match the known QA project.");
  }
  if (payload.supabaseProjectRef === KNOWN_PRODUCTION_PROJECT_REF) {
    throw new Error("[qa-runtime-identity] Deployed Supabase ref is the known Production project.");
  }
  if (payload.supabaseProjectRef !== expectedNodeRef) {
    throw new Error("[qa-runtime-identity] Deployed Supabase ref does not match the guarded Node QA ref.");
  }
}

/**
 * @param {string} baseURL
 * @param {Record<string, string> | undefined} headers
 * @param {typeof fetch} [fetchImpl]
 */
export async function fetchRuntimeIdentity(baseURL, headers, fetchImpl = fetch) {
  const origin = baseURL.replace(/\/$/, "");
  const response = await fetchImpl(`${origin}${QA_META_PATH}`, {
    method: "GET",
    redirect: "manual",
    headers: headers ?? {},
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error("[qa-runtime-identity] Identity endpoint redirected; refusing cross-origin drift.");
  }
  if (!response.ok) {
    throw new Error(`[qa-runtime-identity] Identity endpoint returned HTTP ${response.status}.`);
  }

  const body = await response.json();
  return validateRuntimeIdentityPayload(body);
}
