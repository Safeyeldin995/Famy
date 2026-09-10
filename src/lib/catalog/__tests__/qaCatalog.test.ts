import { describe, expect, it } from "vitest";
import { isQaCatalogLabel } from "@/lib/catalog/qaCatalog";

describe("isQaCatalogLabel", () => {
  it("matches the Production QA fixture prefixes", () => {
    expect(isQaCatalogLabel("QA Booking Service 1785235277607")).toBe(true);
    expect(isQaCatalogLabel("QA_RLS Service")).toBe(true);
    expect(isQaCatalogLabel("QA RLS Other Service")).toBe(true);
  });

  it("does not match real catalog names", () => {
    expect(isQaCatalogLabel("Deep Home Cleaning")).toBe(false);
    expect(isQaCatalogLabel("Move-in / Move-out Cleaning")).toBe(false);
    expect(isQaCatalogLabel("Regular Home Cleaning")).toBe(false);
    expect(isQaCatalogLabel("تنظيف منزل عميق")).toBe(false);
  });
});
