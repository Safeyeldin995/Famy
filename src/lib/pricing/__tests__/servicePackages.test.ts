import { describe, expect, it } from "vitest";
import {
  cairoWallTime,
  filterFixedStartSlots,
  packageLabel,
  servicePriceUnit,
  serviceQuote,
} from "../servicePackages";
const day = { pricing_model: "fixed", duration_min: 480, fixed_start_time: null };
const night = { pricing_model: "fixed", duration_min: 360, fixed_start_time: "18:00:00" };
describe("fixed package display and quotes", () => {
  it("quotes one rate and exact duration for day and night", () => {
    expect(serviceQuote(day, 1000, 2)).toEqual({ subtotal: 1000, durationMinutes: 480 });
    expect(serviceQuote(night, 900, 8)).toEqual({ subtotal: 900, durationMinutes: 360 });
  });
  it("keeps the hourly path and chosen duration unchanged", () => {
    expect(serviceQuote({ pricing_model: "hourly", duration_min: 60 }, 100, 4)).toEqual({
      subtotal: 400,
      durationMinutes: 240,
    });
    expect(servicePriceUnit({ pricing_model: "hourly" }).key).toBe("pricePicker.hourUnit");
  });
  it("uses duration/start rather than a catalog slug for labels", () => {
    expect(servicePriceUnit(day).key).toBe("packages.fullDayUnit");
    expect(servicePriceUnit(night).key).toBe("packages.overnightUnit");
    expect(
      packageLabel({ pricing_model: "fixed", duration_min: 120, fixed_start_time: "10:00" }),
    ).toEqual({ key: "packages.timed", values: { hours: 2, start: "10:00", end: "12:00" } });
  });
  it.each([
    ["2026-01-15", "16:00:00.000Z"],
    ["2026-07-15", "15:00:00.000Z"],
  ])("honors Cairo's offset on %s", (day, end) => {
    const [y, m, d] = day.split("-").map(Number);
    expect(cairoWallTime(new Date(y, m - 1, d), "18:00").toISOString()).toBe(`${day}T${end}`);
  });
  it("supports 24:00 as the next day's boundary", () => {
    expect(cairoWallTime(new Date(2026, 0, 15), "24:00").toISOString()).toBe(
      "2026-01-15T22:00:00.000Z",
    );
  });
  it("filters available instants to 18:00 Cairo without inventing slots", () => {
    const slots = [
      { start: new Date("2026-07-15T14:00:00Z") },
      { start: new Date("2026-07-15T15:00:00Z") },
    ];
    expect(filterFixedStartSlots(slots, night)).toEqual([slots[1]]);
    expect(filterFixedStartSlots([], night)).toEqual([]);
    expect(filterFixedStartSlots(slots, day)).toBe(slots);
    expect(
      filterFixedStartSlots(slots, { pricing_model: "hourly", fixed_start_time: "18:00" }),
    ).toBe(slots);
  });
});
