import { describe, expect, it } from "vitest";
import {
  cairoDatePlusDays,
  cairoDayStartFromYmd,
  localMidnightForCairoInstant,
} from "../onlineWebCairoTime";

describe("cairoDatePlusDays", () => {
  it("returns the same Y-M-D when adding zero days", () => {
    expect(cairoDatePlusDays("2026-11-25", 0)).toBe("2026-11-25");
  });

  it("advances the calendar by one day", () => {
    expect(cairoDatePlusDays("2026-11-25", 1)).toBe("2026-11-26");
  });
});

describe("localMidnightForCairoInstant", () => {
  it("maps a Cairo calendar day to local midnight matching that Y-M-D in UTC", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const cairoChip = cairoDayStartFromYmd("2026-11-26");
      const slotsDay = localMidnightForCairoInstant(cairoChip);
      expect(slotsDay.getFullYear()).toBe(2026);
      expect(slotsDay.getMonth()).toBe(10);
      expect(slotsDay.getDate()).toBe(26);
      const dateStr = `${slotsDay.getFullYear()}-${String(slotsDay.getMonth() + 1).padStart(2, "0")}-${String(slotsDay.getDate()).padStart(2, "0")}`;
      expect(dateStr).toBe("2026-11-26");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});