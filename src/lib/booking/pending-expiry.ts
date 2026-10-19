/**
 * Pending-booking expiry helpers shared by customer, provider, and admin UI.
 * Server defaults match settings.booking_expiry
 * `{ pending_ttl_hours: 12, min_hours_before_start: 2 }`.
 */

export const PROVIDER_NO_RESPONSE_REASON = "provider_no_response";

export const DEFAULT_BOOKING_EXPIRY_SETTINGS = {
  pending_ttl_hours: 12,
  min_hours_before_start: 2,
} as const;

export type BookingExpirySettings = {
  pending_ttl_hours: number;
  min_hours_before_start: number;
};

export function parseBookingExpirySettings(value: unknown): BookingExpirySettings {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const ttl = Number(row.pending_ttl_hours);
  const minBefore = Number(row.min_hours_before_start);
  return {
    pending_ttl_hours:
      Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_BOOKING_EXPIRY_SETTINGS.pending_ttl_hours,
    min_hours_before_start:
      Number.isFinite(minBefore) && minBefore >= 0
        ? minBefore
        : DEFAULT_BOOKING_EXPIRY_SETTINGS.min_hours_before_start,
  };
}

export function isProviderNoResponseCancellation(booking: {
  status?: string | null;
  cancellation_reason?: string | null;
}): boolean {
  return (
    booking.status === "cancelled" && booking.cancellation_reason === PROVIDER_NO_RESPONSE_REASON
  );
}

export function isExpiredCapturedPayment(payment: {
  status?: string | null;
  needs_admin_review?: boolean | null;
  metadata?: unknown;
}): boolean {
  if (payment.needs_admin_review) return true;
  const metadata =
    payment.metadata && typeof payment.metadata === "object"
      ? (payment.metadata as Record<string, unknown>)
      : {};
  return metadata.admin_review_reason === "expired_pending_captured";
}

export function pendingResponseDeadline(
  createdAt: Date | string,
  startAt: Date | string,
  settings: BookingExpirySettings = DEFAULT_BOOKING_EXPIRY_SETTINGS,
): Date {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const ttlDeadline = new Date(created.getTime() + settings.pending_ttl_hours * 3600000);
  const startDeadline = new Date(start.getTime() - settings.min_hours_before_start * 3600000);
  return ttlDeadline.getTime() <= startDeadline.getTime() ? ttlDeadline : startDeadline;
}

export function creationMinHours(
  providerMinNoticeHours: number,
  settings: BookingExpirySettings = DEFAULT_BOOKING_EXPIRY_SETTINGS,
): number {
  return Math.max(settings.min_hours_before_start, Math.max(0, providerMinNoticeHours));
}

export type RespondWithinParts =
  { kind: "minutes"; count: number } | { kind: "hours"; count: number } | { kind: "overdue" };

export function respondWithinParts(deadline: Date, now: Date = new Date()): RespondWithinParts {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return { kind: "overdue" };
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return { kind: "minutes", count: minutes };
  return { kind: "hours", count: Math.max(1, Math.round(minutes / 60)) };
}

export function expiredRequestCopy(
  booking: { status?: string | null; cancellation_reason?: string | null },
  t: (key: string) => string,
): { expired: boolean; title: string; reason: string } {
  const expired = isProviderNoResponseCancellation(booking);
  return {
    expired,
    title: expired ? t("bookingDetail.expiredTitle") : t("bookingDetail.closedCancelledTitle"),
    reason: expired ? t("bookingDetail.expiredReason") : "",
  };
}

export function respondWithinLabel(
  createdAt: Date | string,
  startAt: Date | string,
  t: (key: string, options?: Record<string, unknown>) => string,
  settings?: BookingExpirySettings,
  now: Date = new Date(),
): string {
  const parts = respondWithinParts(pendingResponseDeadline(createdAt, startAt, settings), now);
  if (parts.kind === "overdue") return t("pro.bookings.respondOverdue");
  if (parts.kind === "minutes") {
    return t("pro.bookings.respondWithinMinutes", { count: parts.count });
  }
  return t("pro.bookings.respondWithinHours", { count: parts.count });
}
