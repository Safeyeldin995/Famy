import { describe, expect, it } from "vitest";
import { providerPriceNeedsAdminReview } from "@shared/provider/providerPriceChangeRequest";

describe("mobile provider price change rules", () => {
  it("matches web: approved provider + approved service uses review RPC", () => {
    expect(providerPriceNeedsAdminReview("APPROVED", "approved")).toBe(true);
    expect(providerPriceNeedsAdminReview("SUBMITTED", "approved")).toBe(false);
  });
});
