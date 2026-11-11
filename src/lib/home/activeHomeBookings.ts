/** Active booking statuses shown on the customer home update card. */
export const CUSTOMER_HOME_ACTIVE_STATUSES = [
  "pending",
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

export type CustomerHomeActiveStatus = (typeof CUSTOMER_HOME_ACTIVE_STATUSES)[number];

export function isCustomerHomeActiveStatus(status: string): status is CustomerHomeActiveStatus {
  return (CUSTOMER_HOME_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export type CustomerHomeActiveStatusKey = `customerHome.activeStatus.${CustomerHomeActiveStatus}`;

/** i18n key for the home card status line; null for statuses outside the home set. */
export function homeActiveBookingStatusKey(status: string): CustomerHomeActiveStatusKey | null {
  if (!isCustomerHomeActiveStatus(status)) return null;
  return `customerHome.activeStatus.${status}`;
}

export function customerHomeActiveBookings<T extends { status: string; start_at: string }>(
  bookings: readonly T[],
): T[] {
  return bookings
    .filter((b) => isCustomerHomeActiveStatus(b.status))
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
}

export function pickSoonestCustomerHomeActiveBooking<T extends { status: string; start_at: string }>(
  bookings: readonly T[],
): T | null {
  return customerHomeActiveBookings(bookings)[0] ?? null;
}

export function customerHomeActiveBookingNeedsAction(status: string): boolean {
  return status === "arrived" || status === "completion_requested";
}

export type CustomerHomeActiveBookingCtaKey =
  | "bookingDetail.confirmArrival"
  | "bookingDetail.confirmCompletion"
  | "customerHome.openBooking";

export function customerHomeActiveBookingCtaKey(status: string): CustomerHomeActiveBookingCtaKey {
  if (status === "arrived") return "bookingDetail.confirmArrival";
  if (status === "completion_requested") return "bookingDetail.confirmCompletion";
  return "customerHome.openBooking";
}
