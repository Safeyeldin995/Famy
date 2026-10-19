/** Presentation only; payment creation and status transitions remain unchanged. */
export function paymentPresentation(method: string | null | undefined) {
  if (method === "cash") return { cta: "bookingUx.cashCta", next: "bookingUx.cashNext" };
  if (method === "manual_transfer")
    return { cta: "bookingUx.transferCta", next: "bookingUx.transferNext" };
  if (method === "online") return { cta: "bookFlow.payCta", next: "payment.paymobInstructions" };
  return { cta: "bookingUx.contactSupport", next: "bookFlow.paymentEmpty" };
}
