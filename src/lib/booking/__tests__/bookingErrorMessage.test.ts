import { describe, expect, it } from "vitest";
import { getBookingErrorMessage } from "../errors";

const t = (key: string) => `t:${key}`;

describe("getBookingErrorMessage", () => {
  it("maps known database codes to their message", () => {
    expect(getBookingErrorMessage({ message: "BOOKING_ONLINE_REGION_CLOSED: closed" }, t)).toContain("ONLINE_REGION_CLOSED");
    expect(getBookingErrorMessage({ message: "BOOKING_PHONE_REQUIRED" }, t)).toContain("PHONE_REQUIRED");
    expect(getBookingErrorMessage({ message: "BOOKING_DEBT_OUTSTANDING" }, t)).toContain("DEBT_OUTSTANDING");
    expect(getBookingErrorMessage({ message: "BOOKING_ONLINE_AGE_MINIMUM" }, t)).toContain("ONLINE_AGE_MINIMUM");
  });
  it("treats an overlap conflict as a taken slot", () => {
    expect(getBookingErrorMessage({ message: "conflicting key value violates exclusion constraint", code: "23P01" }, t)).toContain("SLOT_UNAVAILABLE");
  });
  it("never shows a raw server message", () => {
    expect(getBookingErrorMessage({ message: "something internal broke" }, t)).toBe("t:bookFlow.failed");
  });
});
