import { formatEGP, formatNumber } from "@shared/format/egp";

/** Same customer currency presentation as web `formatEGP`, without the web DOM i18n import. */
export function customerNumber(value: number, language: string) {
  return formatNumber(value, language);
}

export function customerMoney(value: number | string, language: string, perHour = false) {
  return formatEGP(Number(value), perHour ? { perHour: true } : undefined, language);
}
