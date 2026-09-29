import { describe, expect, it } from "vitest";
import { selectMarketplaceProviderRows } from "@/lib/db/marketplaceProviderRows";

function row(id: string, category_slug: string, service_slug: string) {
  return { id, category_slug, service_slug, full_name: "Real Provider" };
}

describe("marketplace provider listing", () => {
  it("hides QA services and out-of-scope categories", () => {
    expect(
      selectMarketplaceProviderRows([
        row("qa", "tutoring", "qa-booking-service-1785235277607"),
        { ...row("qa-name", "tutoring", "math-help"), full_name: "QA_Fixture Provider" },
        row("cleaning", "home-cleaning", "deep-home-cleaning"),
        row("tutor", "tutoring", "homework-support"),
      ]).map((provider) => provider.id),
    ).toEqual(["tutor"]);
  });

  it("shows a dual-service provider once on unfiltered lists and in each category", () => {
    const rows = [row("dual", "babysitting", "child-care"), row("dual", "tutoring", "math-help")];

    expect(selectMarketplaceProviderRows(rows).map((provider) => provider.id)).toEqual(["dual"]);
    expect(selectMarketplaceProviderRows(rows, { categorySlug: "babysitting" })).toEqual([rows[0]]);
    expect(selectMarketplaceProviderRows(rows, { categorySlug: "tutoring" })).toEqual([rows[1]]);
  });

  it("filters category before deduplication and limiting", () => {
    const rows = [
      row("dual", "babysitting", "child-care"),
      row("dual", "tutoring", "math-help"),
      row("dual", "tutoring", "science-help"),
      row("other", "tutoring", "science-help"),
    ];

    expect(selectMarketplaceProviderRows(rows, { categorySlug: "tutoring", limit: 2 })).toEqual([
      rows[1],
      rows[3],
    ]);
    expect(selectMarketplaceProviderRows(rows, { categorySlug: "tutoring", limit: 1 })).toEqual([
      rows[1],
    ]);
  });
});
