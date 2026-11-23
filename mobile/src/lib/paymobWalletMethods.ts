import type { PaymobCheckoutChannel } from "@shared/paymob/paymobChannels";

export const PAYMOB_WALLET_APPLE_PAY_METHOD_ID = "__paymob_apple_pay__";
export const PAYMOB_WALLET_GOOGLE_PAY_METHOD_ID = "__paymob_google_pay__";

export function paymobChannelForUiMethodId(methodId: string): PaymobCheckoutChannel | null {
  if (methodId === PAYMOB_WALLET_APPLE_PAY_METHOD_ID) return "apple_pay";
  if (methodId === PAYMOB_WALLET_GOOGLE_PAY_METHOD_ID) return "google_pay";
  return null;
}

export function isPaymobWalletUiMethodId(methodId: string): boolean {
  return paymobChannelForUiMethodId(methodId) != null;
}

export function resolvePaymobOnlinePaymentMethod<
  T extends { id: string; code?: string; method_type: string },
>(methods: T[] | undefined): T | undefined {
  return methods?.find((m) => m.method_type === "online" && m.code === "paymob");
}