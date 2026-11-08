import { describe, expect, it } from "vitest";
import {
  providerPriceChangeDirty,
  providerPriceNeedsAdminReview,
} from "@/lib/provider/providerPriceChangeRequest";

describe("providerPriceNeedsAdminReview", () => {
  it("requires RPC only for approved provider with approved service", () => {
    expect(providerPriceNeedsAdminReview("APPROVED", "approved")).toBe(true);
    expect(providerPriceNeedsAdminReview("APPROVED", "pending")).toBe(false);
    expect(providerPriceNeedsAdminReview("DRAFT", "approved")).toBe(false);
  });
});

describe("providerPriceChangeDirty", () => {
  it("ignores drafts while a pending request exists", () => {
    expect(providerPriceChangeDirty(500, 400, 450)).toBe(false);
  });

  it("detects a new draft different from live price", () => {
    expect(providerPriceChangeDirty(500, 400, null)).toBe(true);
    expect(providerPriceChangeDirty(400, 400, null)).toBe(false);
  });
});
