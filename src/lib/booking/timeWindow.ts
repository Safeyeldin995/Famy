import { minutesUntilSessionCompletionAllowed, sessionDurationEndsAt } from "./sessionLifecycle";

/**
 * Provider travel/actions window: from start_at - 2h through end_at (DB-enforced).
 * Client mirrors for disabling buttons before the server rejects.
 */
export function providerTravelWindowOpen(startAt: string | Date, endAt: string | Date, now = new Date()): boolean {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const t = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return t >= start - 2 * 60 * 60 * 1000 && t <= end;
}

export function providerStepOpensAt(status: string, startAt: string | Date, endAt: string | Date): Date | null {
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return null;
  if (status === "confirmed") return new Date(start - 2 * 60 * 60 * 1000);
  if (status === "on_the_way" || status === "arrived") return new Date(start - 2 * 60 * 60 * 1000);
  return null;
}

export function isProviderStepTooEarly(
  status: string,
  startAt: string | Date,
  endAt: string | Date,
  now = new Date(),
): boolean {
  if (status === "confirmed" || status === "on_the_way" || status === "arrived") {
    return !providerTravelWindowOpen(startAt, endAt, now);
  }
  return false;
}

export function providerCompletionOpensAt(
  booking: Parameters<typeof sessionDurationEndsAt>[0],
): Date {
  return sessionDurationEndsAt(booking);
}

export function isProviderCompletionTooEarly(
  booking: Parameters<typeof sessionDurationEndsAt>[0],
  now = new Date(),
): boolean {
  return now.getTime() < sessionDurationEndsAt(booking).getTime();
}

export function providerCompletionMinutesRemaining(
  booking: Parameters<typeof sessionDurationEndsAt>[0],
  now = new Date(),
): number {
  return minutesUntilSessionCompletionAllowed(sessionDurationEndsAt(booking), now);
}

export function isBookingTooEarlyError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && (message.includes("BOOKING_TOO_EARLY") || message.includes("دقيقة"));
}
