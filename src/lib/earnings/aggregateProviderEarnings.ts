/**
 * Provider-facing amounts. Never treat the customer total (platform fee + VAT
 * − discount) as earnings.
 *
 * Booking value = service subtotal + provider-fulfilled extras + travel fee.
 * Snapshotted net = bookings.price_provider_net (base + travel − commission).
 */
export const EARNINGS_LABEL = {
  net: "pro.earnings.yourNet",
  bookingValue: "pro.earnings.bookingValue",
  commissionUnrecorded: "pro.earnings.commissionUnrecorded",
} as const;

export type EarningsAmountKind = "net" | "bookingValue";
export type EarningsHeadlineKind = EarningsAmountKind | "mixed" | "empty";

export type ProviderEarningsPayment = {
  status: string;
  amount?: number | null;
  captured_at?: string | null;
};

export type ProviderEarningsBooking = {
  id?: string;
  price_subtotal?: number | null;
  price_extras_total?: number | null;
  price_travel_fee?: number | null;
  price_provider_net?: number | null;
  price_commission_percent?: number | null;
  price_commission_amount?: number | null;
  start_at: string;
  status: string;
  payments?: ProviderEarningsPayment[] | null;
};

export type EarningsBucket = {
  net: number;
  bookingValue: number;
};

export type ProviderEarningsTotals = {
  captured: EarningsBucket;
  mtd: EarningsBucket;
  last7: EarningsBucket;
  upcoming: EarningsBucket;
  completedCount: number;
  hasSnapshottedCaptured: boolean;
  hasUnsnapshottedCaptured: boolean;
  hasSnapshottedUpcoming: boolean;
  hasUnsnapshottedUpcoming: boolean;
};

const UPCOMING_STATUSES = new Set(["confirmed", "in_progress", "pending"]);

export function providerBookingValue(row: {
  price_subtotal?: number | null;
  price_extras_total?: number | null;
  price_travel_fee?: number | null;
}): number {
  return (
    Number(row.price_subtotal ?? 0) +
    Number(row.price_extras_total ?? 0) +
    Number(row.price_travel_fee ?? 0)
  );
}

export function isCommissionSnapshotted(row: { price_provider_net?: number | null }): boolean {
  return row.price_provider_net != null && Number.isFinite(Number(row.price_provider_net));
}

export function earningsLabelKey(
  kind: EarningsAmountKind,
): (typeof EARNINGS_LABEL)[EarningsAmountKind] {
  return kind === "net" ? EARNINGS_LABEL.net : EARNINGS_LABEL.bookingValue;
}

export function earningsHeadlineKind(
  hasNet: boolean,
  hasBookingValue: boolean,
): EarningsHeadlineKind {
  if (hasNet && hasBookingValue) return "mixed";
  if (hasNet) return "net";
  if (hasBookingValue) return "bookingValue";
  return "empty";
}

export function capturedPayment(row: ProviderEarningsBooking): ProviderEarningsPayment | undefined {
  return (row.payments ?? []).find((p) => p.status === "captured");
}

function addToBucket(bucket: EarningsBucket, snapshotted: boolean, row: ProviderEarningsBooking) {
  if (snapshotted) bucket.net += Number(row.price_provider_net);
  else bucket.bookingValue += providerBookingValue(row);
}

export function aggregateProviderEarnings(
  rows: ProviderEarningsBooking[],
  now: Date = new Date(),
): ProviderEarningsTotals {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOf7d = now.getTime() - 7 * 24 * 3600e3;
  const captured: EarningsBucket = { net: 0, bookingValue: 0 };
  const mtd: EarningsBucket = { net: 0, bookingValue: 0 };
  const last7: EarningsBucket = { net: 0, bookingValue: 0 };
  const upcoming: EarningsBucket = { net: 0, bookingValue: 0 };
  let completedCount = 0;
  let hasSnapshottedCaptured = false;
  let hasUnsnapshottedCaptured = false;
  let hasSnapshottedUpcoming = false;
  let hasUnsnapshottedUpcoming = false;

  for (const row of rows) {
    const snapshotted = isCommissionSnapshotted(row);
    const payment = capturedPayment(row);
    if (payment) {
      const t = new Date(payment.captured_at ?? row.start_at).getTime();
      addToBucket(captured, snapshotted, row);
      if (snapshotted) hasSnapshottedCaptured = true;
      else hasUnsnapshottedCaptured = true;
      if (row.status === "completed") completedCount += 1;
      if (t >= startOfMonth) addToBucket(mtd, snapshotted, row);
      if (t >= startOf7d) addToBucket(last7, snapshotted, row);
    } else if (UPCOMING_STATUSES.has(row.status)) {
      addToBucket(upcoming, snapshotted, row);
      if (snapshotted) hasSnapshottedUpcoming = true;
      else hasUnsnapshottedUpcoming = true;
    }
  }

  return {
    captured,
    mtd,
    last7,
    upcoming,
    completedCount,
    hasSnapshottedCaptured,
    hasUnsnapshottedCaptured,
    hasSnapshottedUpcoming,
    hasUnsnapshottedUpcoming,
  };
}
