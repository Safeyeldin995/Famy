/** Matches `useBookingPayment` / payment-queries relevant statuses. */
export const BOOKING_PAYMENT_QUERY_STATUSES = [
  "pending",
  "pending_review",
  "captured",
  "partially_refunded",
] as const;

export type BookingPaymentQueryStatus = (typeof BOOKING_PAYMENT_QUERY_STATUSES)[number];

export type BookingPaymentRow = {
  status?: string | null;
  payment_method_type?: string | null;
  proof_path?: string | null;
  created_at?: string | null;
};

export function pickCurrentBookingPayment<T extends BookingPaymentRow>(
  payments: readonly T[] | T | null | undefined,
): T | null {
  const rows = !payments ? [] : Array.isArray(payments) ? payments : [payments];
  const relevant = rows.filter(
    (p): p is T =>
      !!p.status &&
      (BOOKING_PAYMENT_QUERY_STATUSES as readonly string[]).includes(p.status),
  );
  if (!relevant.length) return null;
  return [...relevant].sort(
    (a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0),
  )[0];
}