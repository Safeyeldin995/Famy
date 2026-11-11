/** Pure currency/number formatters (no web i18n singleton — safe for mobile). */
export function formatLocale(language: string) {
  return language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-EG";
}

export function formatNumber(value: number, language: string) {
  return new Intl.NumberFormat(formatLocale(language)).format(value);
}

/** Currency amounts: omit `.00` on whole numbers; currency after the number in Arabic. */
export function formatMoneyNumber(value: number, language: string) {
  const n = Number(value);
  const whole = Math.round(Math.abs(n) * 100) % 100 === 0;
  return new Intl.NumberFormat(formatLocale(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(n);
}

export function formatEGP(
  value: number,
  opts: { perHour?: boolean } | undefined,
  language: string,
) {
  const number = formatMoneyNumber(Number(value), language);
  const ar = language.startsWith("ar");
  if (opts?.perHour) {
    return ar ? `${number} ج.م / الساعة` : `EGP ${number} / hr`;
  }
  return ar ? `${number} ج.م` : `EGP ${number}`;
}
