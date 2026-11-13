import { describe, expect, it } from "vitest";
import { providerWeekLedgerQueryKey } from "../provider-settlement-queries";
import { currentWeekLedgerRange } from "@/lib/settlement/cairoSettlementWeek";

const period = {
  period_start: "2026-11-08T08:00:00.000Z",
  period_end: "2026-11-15T08:00:00.000Z",
  next_settlement_at: "2026-11-22T08:00:00.000Z",
};

describe("providerWeekLedgerQueryKey", () => {
  it("does not change when only the moving upper bound would differ", () => {
    const keyA = providerWeekLedgerQueryKey("prov", period);
    const keyB = providerWeekLedgerQueryKey("prov", period);
    const movingRangeA = currentWeekLedgerRange(period, new Date("2026-11-13T10:00:00.000Z"));
    const movingRangeB = currentWeekLedgerRange(period, new Date("2026-11-13T10:00:01.000Z"));
    expect(movingRangeA.to).not.toBe(movingRangeB.to);
    expect(keyA).toEqual(keyB);
    expect(keyA).toEqual(["provider-week-ledger", "prov", period.period_end, period.next_settlement_at]);
  });
});
