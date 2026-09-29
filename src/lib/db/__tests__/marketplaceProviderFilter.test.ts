import { describe, expect, it } from "vitest";
import { isClosedBetaCategorySlug } from "@/lib/catalog/closedBetaCategories";
import { isQaCatalogSlug, isQaFixtureName } from "@/lib/catalog/qaCatalog";

function isVisibleMarketplaceProviderRow(row: {
  category_slug?: string;
  service_slug?: string;
  full_name?: string;
}) {
  return (
    !isQaCatalogSlug(row.category_slug, row.service_slug) &&
    !isQaFixtureName(row.full_name) &&
    isClosedBetaCategorySlug(row.category_slug)
  );
}

describe("marketplace provider QA filter", () => {
  it("hides fixture services even when the category slug is clean", () => {
    expect(
      isVisibleMarketplaceProviderRow({
        category_slug: "home-cleaning",
        service_slug: "qa-booking-service-1785235277607",
        full_name: "Real Provider",
      }),
    ).toBe(false);
  });

  it("hides out-of-scope categories such as home-cleaning", () => {
    expect(
      isVisibleMarketplaceProviderRow({
        category_slug: "home-cleaning",
        service_slug: "deep-home-cleaning",
        full_name: "Mona Adel",
      }),
    ).toBe(false);
  });

  it("keeps tutoring providers in closed beta discovery", () => {
    expect(
      isVisibleMarketplaceProviderRow({
        category_slug: "tutoring",
        service_slug: "homework-support",
        full_name: "Mona Adel",
      }),
    ).toBe(true);
  });
});
