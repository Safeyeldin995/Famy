/**
 * Provider wallet (Uber-style): one running balance, the bookings that moved it,
 * and the money actually transferred between Famy and the provider.
 *
 * Pure helpers shared by the admin panel, the provider website and the mobile app.
 * Ledger sign: credit = Famy owes the provider more; debit = the provider owes Famy more.
 */

export type WalletLedgerRow = {
  id: string;
  kind: string;
  direction: string;
  amount: number | string;
  payment_method?: string | null;
  booking_id?: string | null;
  note?: string | null;
  created_at: string;
};

export type WalletBooking = {
  id: string;
  price_total?: number | string | null;
  price_provider_net?: number | string | null;
  start_at?: string | null;
};

export type WalletBookingRow = {
  bookingId: string;
  at: string;
  /** How the customer paid. */
  method: "cash" | "online";
  /** What the customer paid, when known. */
  price: number | null;
  /** Famy's commission, when known. */
  commission: number | null;
  /** The provider's share, when known. */
  providerNet: number | null;
  /** Signed effect on the balance (+ Famy owes more, - provider owes more). */
  effect: number;
};

export type WalletTransferRow = {
  id: string;
  at: string;
  kind: "received" | "sent" | "adjustment";
  /** Signed effect on the balance. */
  effect: number;
  reference: string | null;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function signedAmount(row: Pick<WalletLedgerRow, "direction" | "amount">) {
  const a = Math.abs(num(row.amount));
  return row.direction === "credit" ? a : -a;
}

/** Balance from ledger rows (same rule as the server's provider_balance.net). */
export function walletBalance(rows: Pick<WalletLedgerRow, "direction" | "amount">[]) {
  return rows.reduce((sum, r) => sum + signedAmount(r), 0);
}

export function walletBookingRows(
  ledger: WalletLedgerRow[],
  bookings: Map<string, WalletBooking> | Record<string, WalletBooking>,
): WalletBookingRow[] {
  const get = (id: string) =>
    bookings instanceof Map ? bookings.get(id) : (bookings as Record<string, WalletBooking>)[id];
  const rows: WalletBookingRow[] = [];
  for (const e of ledger) {
    if (!e.booking_id) continue;
    if (e.kind !== "cash_collected_platform_share" && e.kind !== "online_provider_share") continue;
    const b = get(e.booking_id);
    const price = b?.price_total == null ? null : num(b.price_total);
    const providerNet = b?.price_provider_net == null ? null : num(b.price_provider_net);
    const commission =
      price != null && providerNet != null ? Math.max(price - providerNet, 0) : null;
    rows.push({
      bookingId: e.booking_id,
      at: b?.start_at ?? e.created_at,
      method: e.kind === "cash_collected_platform_share" ? "cash" : "online",
      price,
      commission:
        commission ?? (e.kind === "cash_collected_platform_share" ? Math.abs(num(e.amount)) : null),
      providerNet:
        providerNet ?? (e.kind === "online_provider_share" ? Math.abs(num(e.amount)) : null),
      effect: signedAmount(e),
    });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** "ref:InstaPay 55821 " -> "InstaPay 55821" (the wallet form stores only the reference). */
export function transferReference(note: string | null | undefined): string | null {
  const m = /^ref:([\s\S]*)$/.exec(String(note ?? "").trim());
  const ref = m ? m[1].trim() : "";
  return ref || null;
}

export function walletTransferRows(ledger: WalletLedgerRow[]): WalletTransferRow[] {
  const rows: WalletTransferRow[] = [];
  for (const e of ledger) {
    const kind =
      e.kind === "debt_payment_received"
        ? "received"
        : e.kind === "payout_sent"
          ? "sent"
          : e.kind === "adjustment"
            ? "adjustment"
            : null;
    if (!kind) continue;
    rows.push({
      id: e.id,
      at: e.created_at,
      kind,
      effect: signedAmount(e),
      reference: transferReference(e.note),
    });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export type WalletState = "providerOwes" | "famyOwes" | "even";

export function walletState(net: number): WalletState {
  if (Math.abs(net) < 0.005) return "even";
  return net > 0 ? "famyOwes" : "providerOwes";
}
