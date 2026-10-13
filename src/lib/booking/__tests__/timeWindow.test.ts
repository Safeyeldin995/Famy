import { describe, expect, it } from "vitest";
import { isBookingTooEarlyError, isProviderStepTooEarly, providerStepOpensAt } from "../timeWindow";

const start = "2026-10-14T12:00:00.000Z";

describe("provider booking time window", () => {
  it("opens 'on the way' 3 hours before the start", () => {
    expect(providerStepOpensAt("confirmed", start)?.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(isProviderStepTooEarly("confirmed", start, new Date("2026-10-14T08:59:00Z"))).toBe(true);
    expect(isProviderStepTooEarly("confirmed", start, new Date("2026-10-14T09:00:00Z"))).toBe(
      false,
    );
  });

  it("opens 'start service' 30 minutes before and 'done' at the start", () => {
    expect(providerStepOpensAt("arrival_confirmed", start)?.toISOString()).toBe(
      "2026-10-14T11:30:00.000Z",
    );
    expect(isProviderStepTooEarly("in_progress", start, new Date("2026-10-14T11:59:00Z"))).toBe(
      true,
    );
    expect(isProviderStepTooEarly("in_progress", start, new Date("2026-10-14T12:00:00Z"))).toBe(
      false,
    );
  });

  it("does not limit other statuses", () => {
    expect(providerStepOpensAt("pending", start)).toBeNull();
    expect(providerStepOpensAt("on_the_way", start)).toBeNull();
    expect(isProviderStepTooEarly("pending", start, new Date(0))).toBe(false);
  });

  it("recognises the server error", () => {
    expect(isBookingTooEarlyError({ message: "BOOKING_TOO_EARLY: This step opens at ..." })).toBe(
      true,
    );
    expect(isBookingTooEarlyError(new Error("other"))).toBe(false);
    expect(isBookingTooEarlyError(null)).toBe(false);
  });
});
