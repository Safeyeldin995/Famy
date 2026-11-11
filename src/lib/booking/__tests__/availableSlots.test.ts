import { describe, expect, it } from "vitest";
import { earliestBookableInstant, isSlotStartBookable } from "../availableSlots";

describe("available slot lead time", () => {
  const now = new Date("2026-11-11T11:36:00.000Z");

  it("allows immediate booking when provider min_notice is 0", () => {
    const earliest = earliestBookableInstant(now, 0);
    expect(earliest.getTime()).toBe(now.getTime());
    const nextSlot = new Date("2026-11-11T12:00:00.000Z");
    expect(isSlotStartBookable(nextSlot, earliest, new Date("2026-12-01T00:00:00.000Z"))).toBe(
      true,
    );
    const pastSlot = new Date("2026-11-11T10:00:00.000Z");
    expect(isSlotStartBookable(pastSlot, earliest, new Date("2026-12-01T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("respects provider min_notice hours without a platform floor", () => {
    const earliest = earliestBookableInstant(now, 2);
    expect(earliest.toISOString()).toBe("2026-11-11T13:36:00.000Z");
    expect(
      isSlotStartBookable(new Date("2026-11-11T14:00:00.000Z"), earliest, new Date("2026-12-01")),
    ).toBe(true);
    expect(
      isSlotStartBookable(new Date("2026-11-11T13:00:00.000Z"), earliest, new Date("2026-12-01")),
    ).toBe(false);
  });
});
