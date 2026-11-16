/**
 * Money is already with Famy (card captured, or an InstaPay receipt uploaded) but the
 * booking will not happen: it must go back to the customer. Same rule as the database
 * function admin_record_payment_refund. Shared by the admin page, website and app.
 */
export const CLOSED_WITHOUT_SERVICE = new Set(["cancelled", "no_show"]);

export function refundOwed(p: {
  paymentStatus?: string | null;
  methodType?: string | null;
  proofPath?: string | null;
  bookingStatus?: string | null;
}): boolean {
  if (!CLOSED_WITHOUT_SERVICE.has(p.bookingStatus ?? "")) return false;
  const type = p.methodType ?? "";
  if (p.paymentStatus === "captured") return type === "online" || type === "manual_transfer";
  return p.paymentStatus === "pending_review" && type === "manual_transfer" && !!p.proofPath;
}
