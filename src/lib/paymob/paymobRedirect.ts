import { createPaymobCheckoutFn } from "@/lib/paymob.functions";

export async function redirectToPaymobCheckout(
  bookingId: string,
  paymentId?: string,
): Promise<{ ok: true; checkoutUrl: string } | { ok: false; message: string }> {
  if (typeof window === "undefined") {
    return { ok: false, message: "Paymob checkout is only available in the browser." };
  }
  try {
    const result = await createPaymobCheckoutFn({ data: { bookingId, paymentId } });
    window.location.assign(result.checkoutUrl);
    return { ok: true, checkoutUrl: result.checkoutUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Paymob checkout.";
    console.error("[paymob.checkout]", message);
    return { ok: false, message };
  }
}
