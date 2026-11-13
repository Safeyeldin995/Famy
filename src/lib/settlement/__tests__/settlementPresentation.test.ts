import { describe, expect, it } from "vitest";
import { providerCashDebtNearLimit } from "../settlementPresentation";

describe("providerCashDebtNearLimit", () => {
  it("is false when balance is positive", () => {
    expect(providerCashDebtNearLimit(10, 1000, 80)).toBe(false);
  });

  it("is true between warn threshold and hard limit", () => {
    expect(providerCashDebtNearLimit(-850, 1000, 80)).toBe(true);
  });

  it("is false once hard limit reached (blocked state)", () => {
    expect(providerCashDebtNearLimit(-1000, 1000, 80)).toBe(false);
  });
});
