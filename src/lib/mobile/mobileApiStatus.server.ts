import { PaymobIntentionIndeterminateError } from "@/lib/paymob/paymobApi.server";

const OTP_SEND_RATE_LIMIT_ERRORS = new Set([
  "rate_limited",
  "rate_limited_phone",
  "rate_limited_ip",
]);

const OTP_SEND_UNAVAILABLE_ERRORS = new Set(["delivery_failed", "temporarily_unavailable"]);

/** HTTP status for a failed mobile OTP send/resend payload (never 500 for expected handler errors). */
export function mobileOtpSendFailureStatus(error: string | undefined): number {
  if (!error) return 400;
  if (OTP_SEND_RATE_LIMIT_ERRORS.has(error)) return 429;
  if (OTP_SEND_UNAVAILABLE_ERRORS.has(error)) return 503;
  if (error === "provider_mismatch" || error === "intent_missing") return 400;
  return 400;
}

export type PaymobCheckoutApiError =
  | "unauthorized"
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "invalid_payment_method"
  | "amount_mismatch"
  | "checkout_in_progress"
  | "checkout_unavailable"
  | "checkout_failed";

export function mapPaymobCheckoutApiFailure(error: unknown): {
  status: number;
  error: PaymobCheckoutApiError;
} {
  if (error instanceof PaymobIntentionIndeterminateError) {
    return { status: 503, error: "checkout_unavailable" };
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "Booking not found." || message === "Payment not found for this booking.") {
    return { status: 404, error: "not_found" };
  }
  if (message === "You cannot pay for this booking.") {
    return { status: 403, error: "forbidden" };
  }
  if (message === "This booking is not using Paymob online payment.") {
    return { status: 400, error: "invalid_payment_method" };
  }
  if (message === "Payment amount does not match the booking total.") {
    return { status: 409, error: "amount_mismatch" };
  }
  if (message === "Paymob checkout is already in progress for this payment.") {
    return { status: 409, error: "checkout_in_progress" };
  }
  if (message === "Could not load checkout data.") {
    return { status: 503, error: "checkout_unavailable" };
  }
  if (message === "Could not save Paymob checkout details.") {
    return { status: 503, error: "checkout_unavailable" };
  }
  return { status: 500, error: "checkout_failed" };
}
