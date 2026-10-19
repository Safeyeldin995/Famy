export type ActiveZoneRow = {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
};

function normalizeAreaToken(value: string): string {
  return value.trim().toLowerCase();
}

export function zoneMatchesPersonalArea(
  zone: ActiveZoneRow,
  area: string,
  governorate: string,
): boolean {
  const tokens = [area, governorate].map(normalizeAreaToken).filter(Boolean);
  if (tokens.length === 0) return false;
  const names = [zone.name_en, zone.name_ar].map((n) => normalizeAreaToken(n ?? "")).filter(Boolean);
  return tokens.some(
    (token) =>
      names.some((name) => name.includes(token) || token.includes(name)) ||
      token.includes(normalizeAreaToken(zone.id.replace(/^zone-/, "").replace(/-/g, " "))),
  );
}

export function suggestInitialZoneSelection(
  zones: ActiveZoneRow[],
  area: string,
  governorate: string,
  savedZoneIds: string[],
): string[] {
  const activeIds = zones.map((z) => z.id);
  const savedActive = savedZoneIds.filter((id) => activeIds.includes(id));
  if (savedActive.length > 0) return savedActive;
  if (activeIds.length === 1) return [activeIds[0]!];
  if (activeIds.length <= 1) return savedActive;
  const matched = zones.filter((z) => zoneMatchesPersonalArea(z, area, governorate)).map((z) => z.id);
  return matched.length > 0 ? matched : savedActive;
}
