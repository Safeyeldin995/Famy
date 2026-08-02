import {
  KNOWN_PRODUCTION_PROJECT_REF,
  KNOWN_QA_PROJECT_REF,
  environmentLabelForProjectRef,
  parseSupabaseProjectRef,
} from "./qa-identity.mjs";

export const QA_META_PATH = "/__qa/meta";

/**
 * Build non-secret runtime identity from the app's configured Supabase URL.
 * @param {Record<string, string | undefined>} [env]
 */
export function buildRuntimeIdentityPayload(env = process.env) {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
  const supabaseProjectRef = parseSupabaseProjectRef(supabaseUrl);
  return {
    environment: environmentLabelForProjectRef(supabaseProjectRef),
    supabaseProjectRef,
  };
}

/**
 * @param {string} pathname
 */
export function isQaMetaPath(pathname) {
  return pathname === QA_META_PATH;
}

/**
 * @param {Request} request
 * @returns {Response | null}
 */
export function handleQaMetaRequest(request, env = process.env) {
  const url = new URL(request.url);
  if (!isQaMetaPath(url.pathname)) return null;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: {
        Allow: "GET",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const payload = buildRuntimeIdentityPayload(env);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Identity unavailable" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
}

export { KNOWN_QA_PROJECT_REF, KNOWN_PRODUCTION_PROJECT_REF };
