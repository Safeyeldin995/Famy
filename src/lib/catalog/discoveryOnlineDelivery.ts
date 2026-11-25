import { homeCategoryDbSlug, isHomeCategoryId } from "./homeCategories";

/** Online / in-person discovery chips apply only to lesson-style categories, not babysitting. */
export function categoryAllowsOnlineDiscovery(categoryGroup: string | undefined): boolean {
  if (!categoryGroup) return true;
  if (isHomeCategoryId(categoryGroup)) {
    return homeCategoryDbSlug(categoryGroup) === "tutoring";
  }
  return categoryGroup !== "babysitting";
}