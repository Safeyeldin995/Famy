/**
 * What the customer pays for a booking: its price plus any earlier unpaid cancellation
 * fees added to it (bookings.carried_fees_amount). Same rule as the database check on
 * payments. Shared by the website, server and app.
 */
type BookingMoney = {
  price_total?: number | string | null;
  carried_fees_amount?: number | string | null;
};

export function carriedFees(b: BookingMoney | null | undefined): number {
  const n = Number(b?.carried_fees_amount ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function bookingAmountDue(b: BookingMoney | null | undefined): number {
  const total = Number(b?.price_total ?? 0);
  return (Number.isFinite(total) ? total : 0) + carriedFees(b);
}
