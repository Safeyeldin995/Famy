import { describe, expect, it } from "vitest";
import {
  isBookingTooEarlyError,
  isProviderCompletionTooEarly,
  isProviderStepTooEarly,
  providerStepOpensAt,
} from "../timeWindow";
import { sessionDurationEndsAt as sessionEnds } from "../sessionLifecycle";

const start = "2026-10-14T10:00:00.000Z";
const end = "2026-10-14T12:00:00.000Z";

describe("provider booking time window", () => {
  it("opens travel actions 2 hours before start through end", () => {
    expect(providerStepOpensAt("confirmed", start, end)?.toISOString()).toBe(
      "2026-10-14T08:00:00.000Z",
    );
    expect(isProviderStepTooEarly("confirmed", start, end, new Date("2026-10-14T07:59:00Z"))).toBe(
      true,
    );
    expect(isProviderStepTooEarly("on_the_way", start, end, new Date("2026-10-14T12:30:00Z"))).toBe(
      true,
    );
    expect(isProviderStepTooEarly("confirmed", start, end, new Date("2026-10-14T09:00:00Z"))).toBe(
      false,
    );
  });

  it("blocks completion until booked duration elapses from session start", () => {
    const booking = {
      start_at: start,
      end_at: end,
      session_started_at: "2026-10-14T10:30:00.000Z",
    };
    expect(isProviderCompletionTooEarly(booking, new Date("2026-10-14T11:00:00Z"))).toBe(true);
    expect(isProviderCompletionTooEarly(booking, new Date("2026-10-14T12:30:00Z"))).toBe(false);
    expect(sessionEnds(booking).toISOString()).toBe("2026-10-14T12:30:00.000Z");
  });

  it("does not limit unrelated statuses", () => {
    expect(providerStepOpensAt("pending", start, end)).toBeNull();
    expect(isProviderStepTooEarly("pending", start, end, new Date(0))).toBe(false);
  });

  it("recognises server errors", () => {
    expect(isBookingTooEarlyError({ message: "BOOKING_TOO_EARLY: This step opens at ..." })).toBe(
      true,
    );
    expect(isBookingTooEarlyError({ message: "تقدر تنهي الجلسة بعد 35 دقيقة" })).toBe(true);
    expect(isBookingTooEarlyError(new Error("other"))).toBe(false);
  });
});
