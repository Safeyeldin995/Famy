import { describe, expect, it } from "vitest";
import { bookingScreenMissingStep } from "../bookingScreens";
import { bookingDisabledReason } from "../disabledReason";

const ready = {
  service: true,
  tutoring: false,
  capability: false,
  slot: true,
  address: true,
  recipient: true,
  supervisionRequired: true,
  supervision: true,
  requirements: true,
  payment: true,
};

describe("supervision booking UX gates", () => {
  it("blocks continue until supervision is chosen on the for-whom step", () => {
    expect(
      bookingScreenMissingStep("whereWho", { ...ready, supervision: false }),
    ).toBe("forWhom");
    expect(bookingScreenMissingStep("whereWho", ready)).toBeNull();
  });

  it("returns chooseSupervision disabled reason after recipient is set", () => {
    expect(
      bookingDisabledReason({
        step: "forWhom",
        allowed: false,
        submitting: false,
        hasRecipient: true,
        hasSupervision: false,
        supervisionRequired: true,
      }),
    ).toBe("bookingUx.chooseSupervision");
  });
});
