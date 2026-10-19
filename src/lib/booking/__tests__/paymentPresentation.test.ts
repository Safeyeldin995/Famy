import { expect, it } from "vitest";
import { paymentPresentation } from "../paymentPresentation";
import en from "@/lib/i18n/locales/en";
import ar from "@/lib/i18n/locales/ar";
it("cash confirms a booking without implying an immediate charge", () => {
  expect(paymentPresentation("cash")).toEqual({
    cta: "bookingUx.cashCta",
    next: "bookingUx.cashNext",
  });
  expect(en.bookingUx.cashCta).toBe("Confirm booking — pay cash on arrival");
  expect(ar.bookingUx.cashCta).toBe("أكد الحجز — الدفع كاش عند الوصول");
});
it("transfer explains the receipt and manual review", () => {
  expect(paymentPresentation("manual_transfer")).toEqual({
    cta: "bookingUx.transferCta",
    next: "bookingUx.transferNext",
  });
  expect(en.bookingUx.transferNext).toBe("Famy confirms manually after you upload the receipt.");
});
it("preserves online payment wording and sends absent methods to support", () => {
  expect(paymentPresentation("online").cta).toBe("bookFlow.payCta");
  expect(paymentPresentation(null).cta).toBe("bookingUx.contactSupport");
  expect(paymentPresentation(undefined).cta).toBe("bookingUx.contactSupport");
});
