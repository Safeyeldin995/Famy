import { describe, expect, it } from "vitest";
import { cairoDatePlusDays } from "../onlineWebCairoTime";

describe("cairoDatePlusDays", () => {
  it("returns the same Y-M-D when adding zero days", () => {
    expect(cairoDatePlusDays("2026-11-25", 0)).toBe("2026-11-25");
  });

  it("advances the calendar by one day", () => {
    expect(cairoDatePlusDays("2026-11-25", 1)).toBe("2026-11-26");
  });
});