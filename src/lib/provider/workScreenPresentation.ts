import { BOOKING_TIMELINE_STEPS } from "@/lib/utils";
import {
  pendingResponseDeadline,
  respondWithinParts,
  type BookingExpirySettings,
} from "@/lib/booking/pending-expiry";
import { formatNumber } from "@/lib/format";

/** Display only: the full id is still used for every route and mutation. */
export function shortBookingCode(id: string): string {
  const clean = id.replace(/[^a-z0-9]/gi, "");
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    return clean.slice(0, 6).toUpperCase();
  }
  return clean.slice(-6).toUpperCase();
}

export function bookingStatusStep(status: string) {
  const index = (BOOKING_TIMELINE_STEPS as readonly string[]).indexOf(status);
  return {
    current: status,
    next: index >= 0 ? (BOOKING_TIMELINE_STEPS[index + 1] ?? null) : null,
    index,
  };
}

export function bookingCountdownLabel(
  createdAt: string | Date,
  startAt: string | Date,
  settings: BookingExpirySettings | undefined,
  now: Date,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const deadline = pendingResponseDeadline(createdAt, startAt, settings);
  if (!Number.isFinite(deadline.getTime())) return null;
  const parts = respondWithinParts(deadline, now);
  if (parts.kind === "overdue") return t("proWork.replyOverdue");
  return t(parts.kind === "hours" ? "proWork.replyHours" : "proWork.replyMinutes", {
    count: formatNumber(parts.count, language),
  });
}

export function notificationRowNavigation(
  notification: { id: string; read_at?: string | null; deep_link?: string | null },
  resolvePath: (path: string) => string,
) {
  return {
    markReadId: notification.read_at ? null : notification.id,
    to: notification.deep_link ? resolvePath(notification.deep_link) : null,
  };
}
