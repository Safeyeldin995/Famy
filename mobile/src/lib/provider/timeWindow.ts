export function providerStepOpensAt(status: string, startAt: string | Date): Date | null {
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return null;
  if (status === "confirmed") return new Date(start - 3 * 60 * 60 * 1000);
  if (status === "arrival_confirmed") return new Date(start - 30 * 60 * 1000);
  if (status === "in_progress") return new Date(start);
  return null;
}

export function isProviderStepTooEarly(status: string, startAt: string | Date, now = new Date()) {
  const opensAt = providerStepOpensAt(status, startAt);
  return !!opensAt && now.getTime() < opensAt.getTime();
}

export function isBookingTooEarlyError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.includes("BOOKING_TOO_EARLY");
}
