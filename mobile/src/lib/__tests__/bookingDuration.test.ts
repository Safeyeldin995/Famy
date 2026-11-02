import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingDurationUnitKey } from "../bookingDuration";

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
});
