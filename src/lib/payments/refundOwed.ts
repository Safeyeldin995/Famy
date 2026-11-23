/**
 * Money is already with Famy (card captured, or an InstaPay receipt uploaded) but the
 * booking will not happen: it must go back to the customer, minus any cancellation fee.
 * Same rule as the database function admin_record_payment_refund. Shared by the admin
 * page, website and app.
 */
export const CLOSED_WITHOUT_SERVICE = new Set(["cancelled", "no_show"]);

type PaymentLike = {
  paymentStatus?: string | null;
  methodType?: string | null;
  proofPath?: string | null;
  walletRefundSettled?: boolean;
};

/** The customer has already paid Famy (so a fee can be deducted and the rest refunded). */
export function moneyHeld(p: PaymentLike): boolean {
  const type = p.methodType ?? "";
  if (p.paymentStatus === "captured") return type === "online" || type === "manual_transfer";
  return p.paymentStatus === "pending_review" && type === "manual_transfer" && !!p.proofPath;
}

export function refundOwed(p: PaymentLike & { bookingStatus?: string | null }): boolean {
  if (p.walletRefundSettled) return false;
  if (p.paymentStatus === "refunded" || p.paymentStatus === "partially_refunded") return false;
  return CLOSED_WITHOUT_SERVICE.has(p.bookingStatus ?? "") && moneyHeld(p);
}
