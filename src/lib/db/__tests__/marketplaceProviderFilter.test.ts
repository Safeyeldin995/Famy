import { describe, expect, it } from "vitest";
import { isQaCatalogSlug, isQaFixtureName } from "@/lib/catalog/qaCatalog";

function isVisibleMarketplaceProviderRow(row: {
  category_slug?: string;
  service_slug?: string;
  full_name?: string;
}) {
  return !isQaCatalogSlug(row.category_slug, row.service_slug) && !isQaFixtureName(row.full_name);
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

  it("keeps real providers on clean service slugs", () => {
    expect(
      isVisibleMarketplaceProviderRow({
        category_slug: "home-cleaning",
        service_slug: "deep-home-cleaning",
        full_name: "Mona Adel",
      }),
    ).toBe(true);
  });
});
