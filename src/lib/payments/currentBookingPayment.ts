import { moneyHeld } from "./refundOwed";

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

/** The booking is already paid (or a transfer receipt is waiting for Famy's review). */
function paidOrInReview(p: BookingPaymentRow): boolean {
  if (p.status === "captured" || p.status === "partially_refunded") return true;
  return moneyHeld({
    paymentStatus: p.status,
    methodType: p.payment_method_type,
    proofPath: p.proof_path,
  });
}

/**
 * The payment that describes the booking now. A payment that already holds the
 * customer's money wins over a newer pending attempt, so a paid booking never
 * asks to be paid again; otherwise the newest relevant attempt.
 */
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
  const newestFirst = [...relevant].sort(
    (a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0),
  );
  return newestFirst.find(paidOrInReview) ?? newestFirst[0];
}
