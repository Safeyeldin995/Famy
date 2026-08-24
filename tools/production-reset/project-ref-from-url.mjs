/** Supabase project refs are 20-char lowercase alphanumeric strings. */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

/**
 * @param {string | null | undefined} value
 */
function isProjectRef(value) {
  return typeof value === "string" && PROJECT_REF_PATTERN.test(value);
}

/**
 * @param {string | null | undefined} restUrl
 */
export function resolveProjectRefFromRestUrl(restUrl) {
  if (!restUrl || typeof restUrl !== "string") return null;

  try {
    const url = new URL(restUrl);
    const hostMatch = url.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/);
    return hostMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve project ref encoded in a Supabase Postgres connection URL.
 *
 * Only inspects the hostname (`db.<ref>.supabase.co`) and username (`postgres.<ref>`).
 * Never inspects password, pathname, search, or the raw URL string.
 *
 * @param {string | null | undefined} databaseUrl
 */
export function resolveProjectRefFromDatabaseUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string") return null;

  try {
    const url = new URL(databaseUrl);
    /** @type {string[]} */
    const refs = [];

    const hostMatch = url.hostname.toLowerCase().match(/^db\.([a-z0-9]{20})\.supabase\.co$/);
    if (hostMatch?.[1] && isProjectRef(hostMatch[1])) {
      refs.push(hostMatch[1]);
    }

    const username = decodeURIComponent(url.username);
    const userMatch = username.match(/^postgres\.([a-z0-9]{20})$/i);
    if (userMatch?.[1]) {
      const ref = userMatch[1].toLowerCase();
      if (isProjectRef(ref)) {
        refs.push(ref);
      }
    }

    if (refs.length === 0) return null;
    const unique = [...new Set(refs)];
    if (unique.length !== 1) return null;
    return unique[0];
  } catch {
    return null;
  }
}
