import { describe, expect, it } from "vitest";
import {
  formatProviderNextSlotLine,
  nextProviderScanDay,
} from "../providerNextSlot";

describe("nextProviderScanDay", () => {
  it("stops when slots exist", () => {
    const today = new Date("2026-11-13T10:00:00Z");
    expect(
      nextProviderScanDay(today, 12, { loading: false, slotCount: 2, now: today }),
    ).toBeNull();
  });

  it("advances one day when empty", () => {
    const today = new Date("2026-11-13T00:00:00.000Z");
    const next = nextProviderScanDay(today, 12, {
      loading: false,
      slotCount: 0,
      now: today,
    });
    expect(next?.toDateString()).toBe(new Date(+today + 86_400_000).toDateString());
  });
});

describe("formatProviderNextSlotLine", () => {
  it("uses tomorrow copy in Arabic", () => {
    const now = new Date("2026-11-13T12:00:00.000Z");
    const start = new Date("2026-11-14T15:00:00.000Z");
    const text = formatProviderNextSlotLine(
      { start, end: start, label: "" },
      "ar",
      true,
      now,
    );
    expect(text).toMatch(/بكرة/);
  });
});
