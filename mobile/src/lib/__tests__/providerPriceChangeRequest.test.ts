import { describe, expect, it } from "vitest";
import {
  providerPriceNeedsAdminReview,
  providerServicePriceEditingBlocked,
} from "@shared/provider/providerPriceChangeRequest";

describe("mobile provider price change rules", () => {
  it("matches web: approved provider + approved service uses review RPC", () => {
    expect(providerPriceNeedsAdminReview("APPROVED", "approved")).toBe(true);
    expect(providerPriceNeedsAdminReview("SUBMITTED", "approved")).toBe(false);
  });

  it("locks price controls while paused", () => {
    expect(providerPriceNeedsAdminReview("APPROVED", "paused")).toBe(false);
    expect(providerServicePriceEditingBlocked("paused")).toBe(true);
  });
});
