import { describe, expect, it } from "vitest";
import {
  CLOSED_BETA_CATEGORY_SLUGS,
  isClosedBetaCategoryRow,
  isClosedBetaCategorySlug,
} from "@/lib/catalog/closedBetaCategories";

describe("closedBetaCategories", () => {
  it("admits babysitting and tutoring only", () => {
    expect([...CLOSED_BETA_CATEGORY_SLUGS]).toEqual(["babysitting", "tutoring"]);
    expect(isClosedBetaCategorySlug("babysitting")).toBe(true);
    expect(isClosedBetaCategorySlug("tutoring")).toBe(true);
  });

  it("excludes home-cleaning and other catalog slugs", () => {
    for (const slug of ["home-cleaning", "cooking", "elderly-care", "pet-care", null, ""]) {
      expect(isClosedBetaCategorySlug(slug)).toBe(false);
    }
  });

  it("filters category rows", () => {
    expect(isClosedBetaCategoryRow({ slug: "tutoring" })).toBe(true);
    expect(isClosedBetaCategoryRow({ slug: "home-cleaning" })).toBe(false);
  });
});
