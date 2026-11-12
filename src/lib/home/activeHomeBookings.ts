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

/** Active booking statuses on the provider home update card (excludes pending). */
export const PROVIDER_HOME_ACTIVE_STATUSES = [
  "confirmed",
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

export type ProviderHomeActiveStatus = (typeof PROVIDER_HOME_ACTIVE_STATUSES)[number];

export function isProviderHomeActiveStatus(status: string): status is ProviderHomeActiveStatus {
  return (PROVIDER_HOME_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export type ProviderHomeActiveStatusKey = `providerHome.activeStatus.${ProviderHomeActiveStatus}`;

export function providerHomeActiveBookingStatusKey(
  status: string,
): ProviderHomeActiveStatusKey | null {
  if (!isProviderHomeActiveStatus(status)) return null;
  return `providerHome.activeStatus.${status}`;
}

export function providerHomeActiveBookings<T extends { status: string; start_at: string }>(
  bookings: readonly T[],
): T[] {
  return bookings
    .filter((b) => isProviderHomeActiveStatus(b.status))
    .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
}

export function pickSoonestProviderHomeActiveBooking<T extends { status: string; start_at: string }>(
  bookings: readonly T[],
): T | null {
  return providerHomeActiveBookings(bookings)[0] ?? null;
}

/** Highlights the card when the provider is waiting on the customer. */
export function providerHomeActiveBookingNeedsAction(status: string): boolean {
  return status === "arrived" || status === "completion_requested";
}

export type ProviderHomeNextStepKey =
  | "providerHome.nextStep.arrived"
  | "providerHome.nextStep.completion_requested";

export function providerHomeActiveBookingNextStepKey(
  status: string,
): ProviderHomeNextStepKey | null {
  if (status === "arrived") return "providerHome.nextStep.arrived";
  if (status === "completion_requested") return "providerHome.nextStep.completion_requested";
  return null;
}

export type ProviderHomeActiveBookingCtaKey =
  | "providerHome.cta.onTheWay"
  | "providerHome.cta.arrived"
  | "providerHome.cta.startService"
  | "providerHome.cta.endSession"
  | "providerHome.openBooking";

export function providerHomeActiveBookingCtaKey(status: string): ProviderHomeActiveBookingCtaKey | null {
  if (status === "confirmed") return "providerHome.cta.onTheWay";
  if (status === "on_the_way") return "providerHome.cta.arrived";
  if (status === "arrival_confirmed") return "providerHome.cta.startService";
  if (status === "in_progress") return "providerHome.cta.endSession";
  return null;
}

export function providerHomeActiveBookingTargetStatus(
  status: string,
): string | null {
  if (status === "confirmed") return "on_the_way";
  if (status === "on_the_way") return "arrived";
  if (status === "arrival_confirmed") return "in_progress";
  if (status === "in_progress") return "completion_requested";
  return null;
}
