/**
 * Identifies QA fixture rows so they never reach customers or provider onboarding.
 *
 * Catalog rows are matched on their SLUG, not their display name.
 *
 * Display names are admin-editable and one genuine Production category is named
 * "Home Cleaning QA_". Matching display names therefore hid the real Home Cleaning
 * category and all three of its services. Slugs are stable identifiers and do not have
 * that problem: verified against Production, slug and name agree on all 479 service rows,
 * so the slug alone identifies every fixture with no false positives.
 *
 * Rows without a slug (zones, provider display names) fall back to a strict prefix match.
 */
const QA_SLUG_RE = /^qa[-_\s]/i;
const QA_NAME_PREFIX_RE = /^QA[_\s]/i;

/** Authoritative check for catalog rows that have a slug. */
export function isQaCatalogSlug(...slugs: Array<string | null | undefined>): boolean {
  return slugs.some((slug) => QA_SLUG_RE.test((slug ?? "").trim()));
}

/**
 * Fallback for records with no slug. Prefix only — never a trailing token, so an admin
 * renaming something to "… QA_" cannot hide a real record.
 */
export function isQaFixtureName(...names: Array<string | null | undefined>): boolean {
  return names.some((name) => QA_NAME_PREFIX_RE.test((name ?? "").trim()));
}

export function isQaCatalogService(row: {
  slug?: string | null;
  category?: { slug?: string | null } | null;
}): boolean {
  return isQaCatalogSlug(row.slug, row.category?.slug);
}
