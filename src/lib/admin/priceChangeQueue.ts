export type AdminPriceChangeKind = "in_person" | "online";

export type ProviderServicePriceRow = {
  id: string;
  provider_id: string;
  service_id: string;
  price_override: number | null;
  pending_price_override: number | null;
  online_price_override: number | null;
  pending_online_price_override: number | null;
  price_change_requested_at: string | null;
  online_price_change_requested_at: string | null;
  provider?: unknown;
  service?: unknown;
};

export type AdminPriceChangeQueueItem = ProviderServicePriceRow & {
  kind: AdminPriceChangeKind;
  /** Pending value for this request (maps to the correct column). */
  pendingAmount: number;
  /** Live customer-facing value before approval. */
  liveAmount: number | null;
  requestedAt: string | null;
};

export function expandAdminPriceChangeQueue(
  rows: ProviderServicePriceRow[],
): AdminPriceChangeQueueItem[] {
  const out: AdminPriceChangeQueueItem[] = [];
  for (const row of rows) {
    if (row.pending_price_override != null) {
      out.push({
        ...row,
        kind: "in_person",
        pendingAmount: row.pending_price_override,
        liveAmount: row.price_override,
        requestedAt: row.price_change_requested_at,
      });
    }
    if (row.pending_online_price_override != null) {
      out.push({
        ...row,
        kind: "online",
        pendingAmount: row.pending_online_price_override,
        liveAmount: row.online_price_override,
        requestedAt: row.online_price_change_requested_at,
      });
    }
  }
  return out.sort((a, b) => {
    const at = a.requestedAt ?? "";
    const bt = b.requestedAt ?? "";
    return at.localeCompare(bt);
  });
}

export function adminPriceChangeKindLabelAr(kind: AdminPriceChangeKind): string {
  return kind === "online" ? "سعر أونلاين" : "سعر حضوري";
}