import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingDurationUnitKey, formatBookingDurationLabel } from "../bookingDuration";

afterEach(() => vi.unstubAllGlobals());
describe("booking detail duration on Android Hermes", () => {
  it("renders the full-day duration when Intl.PluralRules is missing", () => {
    vi.stubGlobal("Intl", { NumberFormat: Intl.NumberFormat, DateTimeFormat: Intl.DateTimeFormat });
    expect(Intl.PluralRules).toBeUndefined();
    expect(bookingDurationUnitKey(8, "ar")).toBe("bookingDuration.hours");
    expect(bookingDurationUnitKey(8, "en")).toBe("bookingDuration.hours");
  });
  it.each([0, 1, 2, 11, 12, 24, 100, 102])("uses the Arabic singular unit for %s", (hours) => {
    expect(bookingDurationUnitKey(hours, "ar")).toBe("bookingDuration.hour");
  });
  it.each([3, 8, 10, 103, 110])("uses the Arabic few unit for %s", (hours) => {
    expect(bookingDurationUnitKey(hours, "ar-EG")).toBe("bookingDuration.hours");
  });
  it("handles English singular and fractional tutoring durations", () => {
    expect(bookingDurationUnitKey(1, "en")).toBe("bookingDuration.hour");
    expect(bookingDurationUnitKey(1.5, "en")).toBe("bookingDuration.hours");
    expect(bookingDurationUnitKey(3.5, "ar")).toBe("bookingDuration.hour");
  });

  it("formats 90 minutes as one hour and thirty minutes", () => {
    const start = "2026-10-14T10:00:00.000Z";
    const end = "2026-10-14T11:30:00.000Z";
    const t = (key: string) =>
      (
        {
          "bookingDuration.hour": "hour",
          "bookingDuration.hours": "hours",
          "bookingDuration.minute": "minute",
          "bookingDuration.minutes": "minutes",
        } as Record<string, string>
      )[key] ?? key;
    expect(formatBookingDurationLabel(start, end, "en", t)).toBe("1 hour · 30 minutes");
  });
});
