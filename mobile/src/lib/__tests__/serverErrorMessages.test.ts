import { describe, expect, it } from "vitest";
import { providerPaymentErrorKey, rescheduleErrorKey } from "../serverErrorMessages";

describe("rescheduleErrorKey", () => {
  it.each([
    ["This reschedule request is no longer open.", "reschedule.errors.notOpen"],
    ["Reschedule must keep the same session length.", "reschedule.errors.sameLength"],
    ["This booking can no longer be rescheduled.", "reschedule.errors.notReschedulable"],
    ["A reason is required to decline a reschedule request.", "reschedule.errors.reasonRequired"],
    ["This time is too close to another booking for this provider.", "reschedule.errors.slotTaken"],
    ["The provider is unavailable during this time.", "reschedule.errors.slotTaken"],
    ["Invalid proposed time range.", "reschedule.errors.invalidTime"],
    ["Only the provider can respond to this request.", "reschedule.errors.notAllowed"],
  ])("maps %s", (message, key) => {
    expect(rescheduleErrorKey({ message })).toBe(key);
  });

  it("maps a bare permission code", () => {
    expect(rescheduleErrorKey({ message: "", code: "42501" })).toBe("reschedule.errors.notAllowed");
  });

  it("never returns the raw message for unknown errors", () => {
    expect(rescheduleErrorKey({ message: "Something odd happened" })).toBe("common.somethingWentWrong");
    expect(rescheduleErrorKey(null)).toBe("common.somethingWentWrong");
  });
});

describe("providerPaymentErrorKey", () => {
  it("maps known payment errors", () => {
    expect(
      providerPaymentErrorKey(new Error("Payment cannot be captured until the booking is completed.")),
    ).toBe("payment.errors.notCompleted");
    expect(providerPaymentErrorKey({ message: "new row violates row-level security policy" })).toBe(
      "payment.errors.notAllowed",
    );
    expect(providerPaymentErrorKey({ message: "boom" })).toBe("common.somethingWentWrong");
  });
});
