import type { PaymobCheckoutChannel } from "./paymobChannels";

export function paymobCheckoutChannelFromPaymentMetadata(
  metadata: unknown,
): PaymobCheckoutChannel | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const raw = record.channel ?? record.paymob_checkout_channel;
  if (raw === "card" || raw === "apple_pay" || raw === "google_pay") return raw;
  return null;
}

export function resolvePaymobCheckoutChannelForPayment(input: {
  metadata?: unknown;
  selectionChannel?: PaymobCheckoutChannel;
  fallback?: PaymobCheckoutChannel;
}): PaymobCheckoutChannel {
  return (
    paymobCheckoutChannelFromPaymentMetadata(input.metadata) ??
    input.selectionChannel ??
    input.fallback ??
    "card"
  );
}