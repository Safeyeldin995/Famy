import { expect, it } from "vitest";
import { bookingDisabledReason } from "../disabledReason";
it("explains loading, errors and submission without inventing a missing choice", () => {
  const state = { step: "requirements" as const, allowed: false, submitting: false };
  expect(bookingDisabledReason({ ...state, error: true })).toBe("bookingUx.retryLoad");
  expect(bookingDisabledReason({ ...state, loading: true })).toBe("bookingUx.loading");
  expect(bookingDisabledReason({ ...state, allowed: true })).toBeNull();
  expect(bookingDisabledReason({ ...state, allowed: true, submitting: true })).toBe(
    "bookingUx.saving",
  );
});
it("distinguishes date, empty slots, time, missing address and unserved area", () => {
  const state = { step: "schedule" as const, allowed: false, submitting: false };
  expect(bookingDisabledReason(state)).toBe("bookingUx.chooseDate");
  expect(bookingDisabledReason({ ...state, hasDate: true, hasSlots: false })).toBe(
    "bookingUx.noSlots",
  );
  expect(bookingDisabledReason({ ...state, hasDate: true, hasSlots: true })).toBe(
    "bookingUx.chooseTime",
  );
  expect(bookingDisabledReason({ ...state, step: "address" })).toBe("bookingUx.chooseAddress");
  expect(bookingDisabledReason({ ...state, step: "address", hasAddress: true })).toBe(
    "bookingUx.outsideArea",
  );
});
it.each(["service", "duration", "forWhom", "requirements", "payment", "summary"] as const)(
  "explains a blocked %s screen",
  (step) => {
    expect(bookingDisabledReason({ step, allowed: false, submitting: false })).toMatch(
      /^bookingUx\./,
    );
  },
);
