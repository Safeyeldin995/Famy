export type PaymobCheckoutChannel = "card" | "apple_pay" | "google_pay";

export const PAYMOB_CHECKOUT_CHANNELS: readonly PaymobCheckoutChannel[] = [
  "card",
  "apple_pay",
  "google_pay",
] as const;

export function parsePaymobCheckoutChannel(
  value: unknown,
  fallback: PaymobCheckoutChannel = "card",
): PaymobCheckoutChannel {
  if (value === "apple_pay" || value === "google_pay" || value === "card") return value;
  return fallback;
}