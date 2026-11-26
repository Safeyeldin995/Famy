import { currentLang } from "@/lib/i18n";
import { joinUiParts } from "./uiJoin";
import * as egp from "./egp";

export { joinUiParts, uiListSeparator } from "./uiJoin";

export function formatLocale(language?: string) {
  return egp.formatLocale(language ?? (currentLang() as string));
}

export function formatNumber(value: number, language?: string) {
  return egp.formatNumber(value, language ?? (currentLang() as string));
}

export function formatMoneyNumber(value: number, language?: string) {
  return egp.formatMoneyNumber(value, language ?? (currentLang() as string));
}

export function formatEGP(
  value: number,
  opts?: { perHour?: boolean },
  language = currentLang() as string,
) {
  return egp.formatEGP(value, opts, language);
}

export function formatDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
  language?: string,
  timeZone?: string,
) {
  const fmt = new Intl.DateTimeFormat(formatLocale(language), {
    ...options,
    ...(timeZone ? { timeZone } : {}),
  });
  return fmt.format(date).replace(/،/g, "");
}

export function formatTime(date: Date, language?: string, timeZone?: string) {
  return new Intl.DateTimeFormat(formatLocale(language), {
    hour: "numeric",
    ...(date.getMinutes() === 0 ? {} : { minute: "2-digit" as const }),
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatDuration(hours: number, language = currentLang() as string) {
  const unit = language.startsWith("ar")
    ? new Intl.PluralRules("ar").select(hours) === "few"
      ? "ساعات"
      : "ساعة"
    : hours === 1
      ? "hour"
      : "hours";
  return `${formatNumber(hours, language)} ${unit}`;
}

export function formatDateTime(
  date: Date,
  language?: string,
  timeZone?: string,
) {
  const resolved = language ?? (currentLang() as string);
  return joinUiParts(
    [formatDate(date, undefined, resolved, timeZone), formatTime(date, resolved, timeZone)],
    resolved,
  );
}

export { formatCustomerBookingListWhen } from "./customerBookingListWhen";

export function formatNotificationDate(
  date: Date,
  now = new Date(),
  language = currentLang() as string,
) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const ar = language.startsWith("ar");
  const label =
    date.toDateString() === now.toDateString()
      ? ar
        ? "النهارده"
        : "Today"
      : date.toDateString() === yesterday.toDateString()
        ? ar
          ? "امبارح"
          : "Yesterday"
        : formatDate(date, undefined, language);
  return joinUiParts([label, formatTime(date, language)], language);
}
