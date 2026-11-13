export type SavedAddressRow = {
  id: string;
  street?: string | null;
  line1?: string | null;
  building?: string | null;
  compound?: string | null;
  area?: string | null;
};

export function formatSavedAddressReviewLine(
  addr: Pick<SavedAddressRow, "street" | "line1" | "building" | "compound" | "area"> | null | undefined,
  areaLabel?: string | null,
): string {
  if (!addr) return "";
  return [addr.street ?? addr.line1, addr.building, addr.compound, areaLabel ?? addr.area]
    .filter(Boolean)
    .join(", ");
}

export function reviewLineForAddressId(
  addresses: SavedAddressRow[],
  addressId: string | null | undefined,
  resolveAreaLabel?: (area: string | null | undefined) => string | null,
): string {
  if (!addressId) return "";
  const addr = addresses.find((a) => a.id === addressId);
  const areaLabel = resolveAreaLabel?.(addr?.area ?? null);
  return formatSavedAddressReviewLine(addr, areaLabel);
}

/** Mobile review / picker labels (area · street · building). */
export function savedAddressMobileUiParts(
  addr: SavedAddressRow | null | undefined,
): string[] {
  if (!addr) return [];
  return [addr.area, addr.street, addr.building].filter(Boolean) as string[];
}
