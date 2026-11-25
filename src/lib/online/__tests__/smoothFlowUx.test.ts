import { describe, expect, it } from "vitest";
import {
  ONLINE_WEB_WALLET_FIRST_CHECKOUT,
  onlineCancellationPolicyForWeb,
  onlineWebCancelPolicySummaryAr,
} from "../smoothFlowUx";

describe("online web smooth flow UX", () => {
  it("uses wallet-first checkout and 4h/50% online cancel defaults", () => {
    expect(ONLINE_WEB_WALLET_FIRST_CHECKOUT).toBe(true);
    expect(onlineCancellationPolicyForWeb()).toEqual({
      fee_mode: "percent",
      fee_value: 50,
      free_cancel_hours: 4,
    });
    expect(onlineWebCancelPolicySummaryAr()).toContain("4");
    expect(onlineWebCancelPolicySummaryAr()).toContain("50%");
  });
});