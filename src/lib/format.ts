import { currentLang } from "@/lib/i18n";

const arabicDigits = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];

function toArabicDigits(s: string) {
  return s.replace(/[0-9]/g, (d) => arabicDigits[Number(d)]);
}

/** Locale-aware Egyptian pounds formatter. */
export function formatEGP(n: number, opts?: { perHour?: boolean }) {
  const lang = currentLang();
  if (lang === "ar") {
    const num = toArabicDigits(new Intl.NumberFormat("ar-EG").format(n));
    return `${num} ج.م${opts?.perHour ? "/س" : ""}`;
  }
  const num = new Intl.NumberFormat("en-EG").format(n);
  return `EGP ${num}${opts?.perHour ? "/hr" : ""}`;
}

export function formatNumber(n: number) {
  const lang = currentLang();
  return lang === "ar"
    ? toArabicDigits(new Intl.NumberFormat("ar-EG").format(n))
    : new Intl.NumberFormat("en-EG").format(n);
}

export function formatDate(d: Date, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  const lang = currentLang();
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-EG", opts).format(d);
}

export function formatTime(d: Date) {
  const lang = currentLang();
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}
