import type { TFunction } from "i18next";
import { formatNumber } from "@/lib/format";

/** Localized seconds label for OTP resend cooldown (numerals + unit in selected language). */
export function formatOtpSecondsDuration(seconds: number, t: TFunction): string {
  const value = Math.max(0, Math.ceil(seconds));
  return t("auth.durationSeconds", {
    formatted: formatNumber(value),
    count: value,
  });
}

function formatTwoDigitSeconds(secs: number): string {
  if (secs >= 10) return formatNumber(secs);
  return `${formatNumber(0)}${formatNumber(secs)}`;
}

/** Localized mm:ss display for OTP expiry (locale numerals throughout). */
export function formatOtpExpiryClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${formatNumber(minutes)}:${formatTwoDigitSeconds(secs)}`;
}
