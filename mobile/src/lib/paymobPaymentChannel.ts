import type { PaymobCheckoutChannel } from "@shared/paymob/paymobChannels";
import {
  paymobCheckoutChannelFromPaymentMetadata,
  resolvePaymobCheckoutChannelForPayment,
} from "@shared/paymob/paymobPaymentChannel";

export { paymobCheckoutChannelFromPaymentMetadata, resolvePaymobCheckoutChannelForPayment };

export function paymobChannelForPaymentBlock(input: {
  payment?: { metadata?: unknown } | null;
  selection?: { paymobChannel?: PaymobCheckoutChannel } | null;
}): PaymobCheckoutChannel {
  return resolvePaymobCheckoutChannelForPayment({
    metadata: input.payment?.metadata,
    selectionChannel: input.selection?.paymobChannel,
  });
}