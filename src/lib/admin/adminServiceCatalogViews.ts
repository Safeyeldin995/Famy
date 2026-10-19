import { isClosedBetaCategorySlug } from "@/lib/catalog/closedBetaCategories";
import { isQaCatalogService } from "@/lib/catalog/qaCatalog";

export type AdminServiceCatalogView = "launch" | "outside_launch" | "test_data";

export type AdminCatalogServiceRow = {
  id?: string;
  slug?: string | null;
  is_active?: boolean;
  name_en?: string | null;
  name_ar?: string | null;
  category?: { slug?: string | null; name_en?: string | null; name_ar?: string | null } | null;
};

/** Partition key for admin catalogue rows (mutually exclusive views). */
export function classifyAdminCatalogService(row: AdminCatalogServiceRow): AdminServiceCatalogView {
  if (isQaCatalogService(row)) return "test_data";
  if (isClosedBetaCategorySlug(row.category?.slug)) return "launch";
  return "outside_launch";
}

export function filterServicesForCatalogView(
  services: AdminCatalogServiceRow[],
  view: AdminServiceCatalogView,
): AdminCatalogServiceRow[] {
  return services.filter((row) => classifyAdminCatalogService(row) === view);
}

export function localizedServiceName(row: AdminCatalogServiceRow, lang: "en" | "ar"): string {
  const primary = lang === "ar" ? row.name_ar : row.name_en;
  const fallback = lang === "ar" ? row.name_en : row.name_ar;
  const value = (primary ?? fallback ?? row.slug ?? "").trim();
  return value || "—";
}

export function localizedCategoryName(row: AdminCatalogServiceRow, lang: "en" | "ar"): string {
  const cat = row.category;
  if (!cat) return "—";
  const primary = lang === "ar" ? cat.name_ar : cat.name_en;
  const fallback = lang === "ar" ? cat.name_en : cat.name_ar;
  return (primary ?? fallback ?? cat.slug ?? "—").trim() || "—";
}
