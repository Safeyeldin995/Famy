export type OnlineLessonLinkBooking = {
  customerId: string;
  providerProfileId: string | null;
};

/** Pick customer vs provider online session route after auth. */
export function resolveOnlineLessonSessionPath(
  bookingId: string,
  viewerUserId: string,
  booking: OnlineLessonLinkBooking,
): "/pro-booking/[id]/session" | "/booking/[id]/session" {
  if (booking.providerProfileId && viewerUserId === booking.providerProfileId) {
    return "/pro-booking/[id]/session";
  }
  return "/booking/[id]/session";
}

export function onlineLessonSessionHref(
  bookingId: string,
  viewerUserId: string,
  booking: OnlineLessonLinkBooking,
): string {
  const route = resolveOnlineLessonSessionPath(bookingId, viewerUserId, booking);
  if (route === "/pro-booking/[id]/session") {
    return `/pro-booking/${bookingId}/session`;
  }
  return `/booking/${bookingId}/session`;
}