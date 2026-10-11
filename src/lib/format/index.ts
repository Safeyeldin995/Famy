import { currentLang } from "@/lib/i18n";

export function formatLocale(language = currentLang() as string) {
  return language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-EG";
}

export function formatNumber(value: number, language?: string) {
  return new Intl.NumberFormat(formatLocale(language)).format(value);
}

export function formatEGP(
  value: number,
  opts?: { perHour?: boolean },
  language = currentLang() as string,
) {
  const number = formatNumber(value, language);
  return language.startsWith("ar")
    ? `${number} ج.م${opts?.perHour ? "/س" : ""}`
    : `EGP ${number}${opts?.perHour ? "/hr" : ""}`;
}

export function formatDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
  language?: string,
) {
  return new Intl.DateTimeFormat(formatLocale(language), options).format(date).replace(/،/g, "");
}

export function formatTime(date: Date, language?: string) {
  return new Intl.DateTimeFormat(formatLocale(language), {
    hour: "numeric",
    ...(date.getMinutes() === 0 ? {} : { minute: "2-digit" as const }),
    hour12: true,
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

export function formatDateTime(date: Date, language?: string) {
  return `${formatDate(date, undefined, language)} · ${formatTime(date, language)}`;
}

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
  return `${label} · ${formatTime(date, language)}`;
}
