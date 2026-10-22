/** OTP timer copy for mobile (no web-only @/lib/format imports). */

export function formatOtpSecondsDuration(
  seconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const value = Math.max(0, Math.ceil(seconds));
  return t("auth.durationSeconds", { formatted: String(value), count: value });
}

export function formatOtpExpiryClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
}
