import type { TFunction } from "i18next";

/**
 * Turns an RPC / network error into a plain Arabic (or English) sentence for
 * an admin toast. Never shows the raw database text: unknown errors fall back
 * to the action-specific message passed in.
 */
const CODE_KEYS: Array<[RegExp, string]> = [
  [/WALLET_REFUND_TOO_HIGH/, "adminErrors.walletRefundTooHigh"],
  [/WALLET_REFUND_BLOCKED:already_refunded/, "adminErrors.walletAlreadyRefunded"],
  [/WALLET_REFUND_BLOCKED:booking_active/, "adminErrors.walletBookingActive"],
  [/WALLET_REFUND_BLOCKED:(no_held_money|nothing_left)/, "adminErrors.walletNothingHeld"],
  [/WALLET_REFUND_BLOCKED/, "adminErrors.walletChanged"],
  [/WALLET_INSUFFICIENT|balance is insufficient/i, "adminErrors.walletInsufficient"],
  [/WALLET_REASON_REQUIRED|reason is required/i, "adminErrors.reasonRequired"],
  [/WALLET_CATEGORY_INVALID/, "adminErrors.reasonRequired"],
  [/WALLET_AMOUNT_INVALID|must be positive/i, "adminErrors.amountInvalid"],
  [/WALLET_IDEMPOTENCY_CONFLICT/, "adminErrors.duplicateSubmit"],
  [/WALLET_BOOKING_MISMATCH/, "adminErrors.bookingMismatch"],
  [/Admin required|42501|permission denied|not allowed/i, "adminErrors.notAllowed"],
  [/MFA|aal2/i, "adminErrors.mfaRequired"],
  [/not found|P0002/i, "adminErrors.notFound"],
  [/Failed to fetch|NetworkError|network|timeout/i, "adminErrors.network"],
  [/duplicate key|23505/i, "adminErrors.duplicate"],
];

export function adminErrorKey(error: unknown): string | null {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : typeof error === "string"
          ? error
          : "";
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code ?? "")
      : "";
  const haystack = `${text} ${code}`;
  for (const [pattern, key] of CODE_KEYS) {
    if (pattern.test(haystack)) return key;
  }
  return null;
}

export function adminErrorText(t: TFunction, error: unknown, fallback: string): string {
  const key = adminErrorKey(error);
  if (typeof console !== "undefined" && error) {
    // Keep the raw error for whoever opens the console; the admin sees plain words.
    console.warn("[admin action failed]", error);
  }
  return key ? t(key) : fallback;
}
