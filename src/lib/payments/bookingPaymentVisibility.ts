/** Statuses that can be surfaced as the booking's current payment. */
export const BOOKING_PAYMENT_QUERY_STATUSES = [
  "pending",
  "pending_review",
  "captured",
  "partially_refunded",
  "rejected",
] as const;

/** How many recent attempts to load before choosing the one to show. */
export const BOOKING_PAYMENT_QUERY_LIMIT = 20;

const FUNDING_STATUSES = new Set(["captured", "partially_refunded"]);

type PaymentRowLike = {
  status: string;
  created_at: string;
  metadata?: unknown;
};

function excludedFromFunding(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const value = (metadata as Record<string, unknown>).excluded_from_booking_funding;
  return value === true || value === "true";
}

/**
 * Picks the payment to show on a booking.
 * The attempt that actually funds the booking wins, so a newer pending retry never asks
 * the customer to pay again after an older attempt was captured late.
 * Without a funding row, the latest attempt is shown.
 * `rows` may come in any order.
 */
export function pickBookingPaymentRow<T extends PaymentRowLike>(
  rows: readonly T[] | null | undefined,
): T | null {
  if (!rows || rows.length === 0) return null;
  const newestFirst = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const funding = newestFirst.find(
    (row) => FUNDING_STATUSES.has(row.status) && !excludedFromFunding(row.metadata),
  );
  return funding ?? newestFirst[0] ?? null;
}
