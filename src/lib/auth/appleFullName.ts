export type ApplePersonName = {
  givenName?: string | null;
  familyName?: string | null;
  middleName?: string | null;
  nickname?: string | null;
};

/** Formats Sign in with Apple person name (only supplied on the first authorization). */
export function formatAppleFullName(name: ApplePersonName | null | undefined): string | null {
  if (!name) return null;
  const parts = [name.givenName, name.middleName, name.familyName, name.nickname]
    .map((part) => part?.trim())
    .filter(Boolean);
  const full = parts.join(" ").trim();
  return full.length > 1 ? full : null;
}