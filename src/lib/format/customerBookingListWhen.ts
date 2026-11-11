import { joinUiParts } from "./uiJoin";

/** Customer bookings list: short weekday, day month، time (Cairo). No web-only imports. */
export function formatCustomerBookingListWhen(iso: string, language: string) {
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-EG";
  const start = new Date(iso);
  const dateLabel = start.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Africa/Cairo",
  });
  const timeLabel = start.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  });
  return joinUiParts([dateLabel, timeLabel], language);
}
