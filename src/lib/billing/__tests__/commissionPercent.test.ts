import { describe, expect, it } from "vitest";
import {
  COMMISSION_PERCENT_MAX,
  commissionPercentEqual,
  parseCommissionPercent,
} from "../commissionPercent";

describe("parseCommissionPercent", () => {
  it("treats empty as not set", () => {
    expect(parseCommissionPercent("")).toEqual({ ok: true, value: null });
    expect(parseCommissionPercent("   ")).toEqual({ ok: true, value: null });
    expect(parseCommissionPercent(null)).toEqual({ ok: true, value: null });
    expect(parseCommissionPercent(undefined)).toEqual({ ok: true, value: null });
  });

  it("accepts 0, the max, and two-decimal fixture values", () => {
    expect(parseCommissionPercent(0)).toEqual({ ok: true, value: 0 });
    expect(parseCommissionPercent(COMMISSION_PERCENT_MAX)).toEqual({
      ok: true,
      value: COMMISSION_PERCENT_MAX,
    });
    // Fixture rate used by tests only — not a product default.
    expect(parseCommissionPercent(12.5)).toEqual({ ok: true, value: 12.5 });
    expect(parseCommissionPercent("12.50")).toEqual({ ok: true, value: 12.5 });
  });

  it("rejects out of range, too many decimals, and junk", () => {
    expect(parseCommissionPercent(-0.01)).toEqual({ ok: false, reason: "range" });
    expect(parseCommissionPercent(50.01)).toEqual({ ok: false, reason: "range" });
    expect(parseCommissionPercent("12.555")).toEqual({ ok: false, reason: "decimals" });
    expect(parseCommissionPercent("abc")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("commissionPercentEqual", () => {
  it("treats null as equal to null and distinct from zero", () => {
    expect(commissionPercentEqual(null, null)).toBe(true);
    expect(commissionPercentEqual(null, 0)).toBe(false);
    expect(commissionPercentEqual(12.5, 12.5)).toBe(true);
  });
});
