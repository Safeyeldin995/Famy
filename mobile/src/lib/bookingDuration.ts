/** Hermes does not provide Intl.PluralRules on our Android preview runtime. */
import { joinUiParts } from "@shared/format/uiJoin";

export function bookingDurationUnitKey(hours: number, language: string) {
  const plural = language.startsWith("ar")
    ? Number.isInteger(hours) && hours % 100 >= 3 && hours % 100 <= 10
    : hours !== 1;
  return plural ? "bookingDuration.hours" : "bookingDuration.hour";
}

export function bookingDurationMinuteKey(minutes: number, language: string) {
  const plural = language.startsWith("ar")
    ? Number.isInteger(minutes) && minutes % 100 >= 3 && minutes % 100 <= 10
    : minutes !== 1;
  return plural ? "bookingDuration.minutes" : "bookingDuration.minute";
}

export function bookingDurationParts(startIso: string, endIso: string) {
  const totalMinutes = Math.max(1, Math.round((+new Date(endIso) - +new Date(startIso)) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes, totalMinutes };
}

export function formatBookingDurationLabel(
  startIso: string,
  endIso: string,
  language: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const { hours, minutes } = bookingDurationParts(startIso, endIso);
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(
      `${new Intl.NumberFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-US").format(hours)} ${t(bookingDurationUnitKey(hours, language))}`,
    );
  }
  if (minutes > 0) {
    parts.push(
      `${new Intl.NumberFormat(language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-US").format(minutes)} ${t(bookingDurationMinuteKey(minutes, language))}`,
    );
  }
  return joinUiParts(parts, language);
}
