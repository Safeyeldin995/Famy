/** Supabase project refs are 20-char lowercase alphanumeric strings. */
const PROJECT_REF_PATTERN = "([a-z0-9]{20})";

/**
 * @param {string | null | undefined} restUrl
 */
export function resolveProjectRefFromRestUrl(restUrl) {
  if (!restUrl) return null;
  const match = restUrl.match(new RegExp(`^https://${PROJECT_REF_PATTERN}\\.supabase\\.co/?$`, "i"));
  return match?.[1] ?? null;
}

/**
 * Resolve project ref encoded in a Supabase Postgres connection URL.
 *
 * @param {string | null | undefined} databaseUrl
 */
export function resolveProjectRefFromDatabaseUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string") return null;

  const patterns = [
    new RegExp(`db\\.${PROJECT_REF_PATTERN}\\.supabase\\.co`, "i"),
    new RegExp(`postgres\\.${PROJECT_REF_PATTERN}[@:]`, "i"),
    new RegExp(`//postgres\\.${PROJECT_REF_PATTERN}@`, "i"),
  ];

  for (const pattern of patterns) {
    const match = databaseUrl.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}
