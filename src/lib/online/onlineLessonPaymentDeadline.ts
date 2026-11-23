/** Matches `booking_expiry_settings()` defaults for online confirm → pay. */
export function onlineLessonPaymentDeadline(
  confirmedAt: string,
  startAt: string,
  settings?: { hoursAfterConfirm?: number; minutesBeforeStart?: number },
  now = Date.now(),
): Date {
  const hours = settings?.hoursAfterConfirm ?? 2;
  const minutes = settings?.minutesBeforeStart ?? 60;
  const afterConfirm = new Date(confirmedAt).getTime() + hours * 3_600_000;
  const beforeStart = new Date(startAt).getTime() - minutes * 60_000;
  return new Date(Math.min(afterConfirm, beforeStart));
}

export function onlineLessonPaymentDeadlineMs(
  confirmedAt: string | null | undefined,
  startAt: string,
  settings?: { hoursAfterConfirm?: number; minutesBeforeStart?: number },
): number | null {
  if (!confirmedAt) return null;
  const deadline = onlineLessonPaymentDeadline(confirmedAt, startAt, settings);
  return Math.max(0, deadline.getTime() - Date.now());
}