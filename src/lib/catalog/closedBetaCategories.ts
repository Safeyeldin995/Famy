/** Closed-beta customer/provider category policy (Issue #78). */
export const CLOSED_BETA_CATEGORY_SLUGS = ["babysitting", "tutoring", "quran", "music"] as const;

export type ClosedBetaCategorySlug = (typeof CLOSED_BETA_CATEGORY_SLUGS)[number];

export function isClosedBetaCategorySlug(
  slug: string | null | undefined,
): slug is ClosedBetaCategorySlug {
  return (
    slug === "babysitting" || slug === "tutoring" || slug === "quran" || slug === "music"
  );
}

export function isClosedBetaCategoryRow(row: { slug?: string | null } | null | undefined) {
  return isClosedBetaCategorySlug(row?.slug ?? null);
}
