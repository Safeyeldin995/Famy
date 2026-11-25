/** Statuses surfaced as the “current” payment on booking detail (latest row wins). */
export const BOOKING_PAYMENT_QUERY_STATUSES = [
  "pending",
  "pending_review",
  "captured",
  "partially_refunded",
  "rejected",
] as const;
