import type { QueryClient } from "@tanstack/react-query";

/** Keys refreshed when a booking-related push arrives while the app is open. */
export function bookingPushInvalidationKeys(): readonly (readonly string[])[] {
  return [["my-bookings"], ...notificationReadInvalidationKeys()];
}

/** Keys refreshed after notification read state changes (customer + provider tabs). */
export function notificationReadInvalidationKeys(): readonly (readonly string[])[] {
  return [
    ["notifications"],
    ["pro-notifications"],
    ["notifications", "unread-count"],
    ["pro-notifications", "unread-count"],
  ];
}

export function rescheduleActionInvalidationKeys(
  bookingId: string,
): readonly (readonly string[])[] {
  return [
    ["reschedule-requests", bookingId],
    ["booking", bookingId],
    ["my-bookings"],
    ["provider-booking", bookingId],
    ["provider-bookings"],
  ];
}

export function bookingCancelInvalidationKeys(bookingId: string): readonly (readonly string[])[] {
  return [
    ["booking", bookingId],
    ["booking-cancellation", bookingId],
    ["provider-booking", bookingId],
    ["my-bookings"],
    ["provider-bookings"],
    ["admin", "bookings"],
    ["payment", bookingId],
  ];
}

export function submitReviewInvalidationKeys(
  bookingId: string,
  providerId: string,
): readonly (readonly string[])[] {
  return [
    ["booking-review", bookingId],
    ["reviews", providerId],
  ];
}

/** Resolves once every listed query has refetched, so callers can keep busy guards on until then. */
export function invalidateQueryKeyList(
  qc: QueryClient,
  keys: readonly (readonly string[])[],
): Promise<void> {
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}

/** Skip OTP auto-abandon while verify/resend is active so the user is not kicked mid-submit. */
export function shouldAbandonOtpOnExpiry(input: {
  otpExpiresIn: number;
  loadingContext: boolean;
  verifying: boolean;
  resending: boolean;
}): boolean {
  if (input.otpExpiresIn !== 0 || input.loadingContext) return false;
  return !input.verifying && !input.resending;
}
