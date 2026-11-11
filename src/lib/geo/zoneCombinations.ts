export type ZoneCombinationRow = { zone_a: string; zone_b: string };

export function partnerZoneIdsFor(zoneId: string, rows: ZoneCombinationRow[]): string[] {
  const partners: string[] = [];
  for (const row of rows) {
    if (row.zone_a === zoneId) partners.push(row.zone_b);
    else if (row.zone_b === zoneId) partners.push(row.zone_a);
  }
  return partners;
}

export function combinationLabel(
  zoneId: string,
  rows: ZoneCombinationRow[],
  nameFor: (id: string) => string | undefined,
): string {
  const partners = partnerZoneIdsFor(zoneId, rows);
  if (partners.length === 0) return "";
  return partners.map((id) => nameFor(id)).filter(Boolean).join("، ");
}
