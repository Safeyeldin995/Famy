import { isClosedBetaCategorySlug } from "@/lib/catalog/closedBetaCategories";
import { isQaCatalogSlug, isQaFixtureName } from "@/lib/catalog/qaCatalog";

type MarketplaceProviderRow = {
  id: string;
  category_slug: string | null;
  service_slug: string | null;
  full_name: string | null;
};

/** Keep one card per provider, after selecting the requested beta category. */
export function selectMarketplaceProviderRows<T extends MarketplaceProviderRow>(
  rows: T[],
  opts: { categorySlug?: string; limit?: number } = {},
): T[] {
  const seenProviders = new Set<string>();
  return rows
    .filter((row) => {
      if (
        isQaCatalogSlug(row.category_slug, row.service_slug) ||
        isQaFixtureName(row.full_name) ||
        !isClosedBetaCategorySlug(row.category_slug) ||
        (opts.categorySlug && row.category_slug !== opts.categorySlug) ||
        seenProviders.has(row.id)
      ) {
        return false;
      }
      seenProviders.add(row.id);
      return true;
    })
    .slice(0, opts.limit ?? 50);
}
