import { describe, expect, it } from "vitest";
import { bookingScreenPrimaryCtaKey } from "../bookingStepCta";

describe("bookingScreenPrimaryCtaKey", () => {
  it("maps the four booking screens", () => {
    expect(bookingScreenPrimaryCtaKey("service", false)).toBe("bookFlow.ctaPickWhen");
    expect(bookingScreenPrimaryCtaKey("when", false)).toBe("bookFlow.ctaConfirmVisit");
    expect(bookingScreenPrimaryCtaKey("whereWho", false)).toBe("bookFlow.ctaReviewPay");
    expect(bookingScreenPrimaryCtaKey("review", false)).toBe("customerBooking.confirm");
  });
});
