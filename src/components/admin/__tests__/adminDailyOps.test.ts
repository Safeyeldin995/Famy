import { describe, expect, it } from "vitest";
import { statementRangeForPreset } from "@/lib/settlement/cairoSettlementWeek";

describe("statementRangeForPreset", () => {
  it("lastMonth ends at start of current Cairo month", () => {
    const now = new Date("2026-03-15T12:00:00.000Z");
    const range = statementRangeForPreset("lastMonth", now);
    expect(range.to < range.from).toBe(false);
    expect(new Date(range.to).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});