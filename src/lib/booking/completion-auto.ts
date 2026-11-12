import type { BookingExpirySettings } from "./pending-expiry";

export function autoCompleteClosesAt(
  completionRequestedAt: string | Date,
  settings: Pick<BookingExpirySettings, "auto_complete_hours">,
): Date {
  const start = new Date(completionRequestedAt).getTime();
  if (Number.isNaN(start)) return new Date();
  return new Date(start + settings.auto_complete_hours * 60 * 60 * 1000);
}
