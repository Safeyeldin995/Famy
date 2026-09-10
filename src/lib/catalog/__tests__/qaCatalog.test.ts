import { describe, expect, it } from "vitest";
import { isQaCatalogLabel, isQaCatalogService } from "@/lib/catalog/qaCatalog";

describe("isQaCatalogLabel", () => {
  it("matches Production QA fixture prefixes", () => {
    expect(isQaCatalogLabel("QA Booking Service 1785235277607")).toBe(true);
    expect(isQaCatalogLabel("QA_RLS Service")).toBe(true);
    expect(isQaCatalogLabel("QA RLS Other Service")).toBe(true);
    expect(isQaCatalogLabel("QA RLS Service")).toBe(true);
  });

  it("matches trailing QA_ category names without hiding FAQ", () => {
    expect(isQaCatalogLabel("Home Cleaning QA_")).toBe(true);
    expect(isQaCatalogLabel("Home Cleaning QA_ ")).toBe(true);
    expect(isQaCatalogLabel("FAQ")).toBe(false);
    expect(isQaCatalogLabel("Frequently asked questions")).toBe(false);
  });

  it("does not match real catalog names", () => {
    expect(isQaCatalogLabel("Deep Home Cleaning")).toBe(false);
    expect(isQaCatalogLabel("Move-in / Move-out Cleaning")).toBe(false);
    expect(isQaCatalogLabel("Regular Home Cleaning")).toBe(false);
    expect(isQaCatalogLabel("Full-Day Babysitting")).toBe(false);
    expect(isQaCatalogLabel("تنظيف منزل عميق")).toBe(false);
    expect(isQaCatalogLabel("Babysitting")).toBe(false);
  });
});

describe("isQaCatalogService", () => {
  it("hides a real-looking service when its category is a QA fixture", () => {
    expect(
      isQaCatalogService({
        name_en: "Deep Home Cleaning",
        name_ar: "تنظيف منزل عميق",
        slug: "deep-home-cleaning",
        category: {
          name_en: "Home Cleaning QA_",
          name_ar: "Home Cleaning QA_",
          slug: "home-cleaning",
        },
      }),
    ).toBe(true);
  });

  it("keeps a real service under a real category", () => {
    expect(
      isQaCatalogService({
        name_en: "Deep Home Cleaning",
        name_ar: "تنظيف منزل عميق",
        slug: "deep-home-cleaning",
        category: { name_en: "Home Cleaning", name_ar: "تنظيف المنزل", slug: "home-cleaning" },
      }),
    ).toBe(false);
  });
});
