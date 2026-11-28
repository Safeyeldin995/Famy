import { isTutoringCategorySlug } from "../tutoring/teachingCapabilities";

/** Online / in-person discovery chips apply only to teaching categories, not babysitting. */
export function categoryAllowsOnlineDiscovery(categoryGroup: string | undefined): boolean {
  if (!categoryGroup) return true;
  return isTutoringCategorySlug(categoryGroup);
}
