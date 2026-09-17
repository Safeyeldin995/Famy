import { describe, expect, it } from "vitest";
import {
  isQaCatalogService,
  isQaCatalogSlug,
  isQaFixtureName,
} from "@/lib/catalog/qaCatalog";

describe("isQaCatalogSlug", () => {
  it("matches the Production fixture slug shapes", () => {
    expect(isQaCatalogSlug("qa-booking-service-1785235277607")).toBe(true);
    expect(isQaCatalogSlug("qa_rls_service")).toBe(true);
    expect(isQaCatalogSlug("QA-Patch2-Marketplace")).toBe(true);
  });

  it("keeps every real catalog slug", () => {
    for (const slug of [
      "home-cleaning",
      "deep-home-cleaning",
      "regular-home-cleaning",
      "babysitting",
      "tutoring",
      "quarterly-deep-clean",
      "qatar-special",
    ]) {
      expect(isQaCatalogSlug(slug)).toBe(false);
    }
  });

  it("ignores null and empty input", () => {
    expect(isQaCatalogSlug(null, undefined, "")).toBe(false);
  });
});

describe("isQaFixtureName", () => {
  it("matches a fixture name prefix", () => {
    expect(isQaFixtureName("QA Booking Service 1785235277607")).toBe(true);
    expect(isQaFixtureName("QA_RLS Zone")).toBe(true);
  });

  it("does NOT match a trailing QA_ token", () => {
    // The real Production category is named "Home Cleaning QA_". Matching a trailing
    // token hid it and all three of its services.
    expect(isQaFixtureName("Home Cleaning QA_")).toBe(false);
  });

  it("keeps ordinary names", () => {
    expect(isQaFixtureName("Deep Home Cleaning")).toBe(false);
    expect(isQaFixtureName("FAQ Support")).toBe(false);
    expect(isQaFixtureName("تنظيف منزل عميق")).toBe(false);
  });
});

describe("isQaCatalogService", () => {
  it("hides a fixture service", () => {
    expect(isQaCatalogService({ slug: "qa-booking-service-1", category: { slug: "qa-cat" } })).toBe(
      true,
    );
  });

  it("hides a real service that sits under a fixture category", () => {
    expect(isQaCatalogService({ slug: "regular-home-cleaning", category: { slug: "qa_cat" } })).toBe(
      true,
    );
  });

  it("keeps the real Home Cleaning services even though the category NAME contains QA_", () => {
    // Regression: the Production category display name is "Home Cleaning QA_" while its
    // slug is the clean "home-cleaning".
    for (const slug of ["deep-home-cleaning", "regular-home-cleaning", "move-in-move-out-cleaning"]) {
      expect(isQaCatalogService({ slug, category: { slug: "home-cleaning" } })).toBe(false);
    }
  });
});
