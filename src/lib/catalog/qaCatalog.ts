/**
 * QA fixture catalog rows use a `QA_` / `QA ` prefix, or a trailing `QA_`
 * token on the category name (e.g. "Home Cleaning QA_"). Real catalog names
 * do not. `FAQ` and ordinary product names must stay visible.
 */
const QA_PREFIX_RE = /^QA[_\s-]/i;
const QA_TOKEN_RE = /(^|[\s_-])QA_/i;

export function isQaCatalogLabel(...names: Array<string | null | undefined>): boolean {
  return names.some((name) => {
    const value = (name ?? "").trim();
    if (!value) return false;
    return QA_PREFIX_RE.test(value) || QA_TOKEN_RE.test(value);
  });
}

export function isQaCatalogService(row: {
  name_en?: string | null;
  name_ar?: string | null;
  slug?: string | null;
  category?: {
    name_en?: string | null;
    name_ar?: string | null;
    slug?: string | null;
  } | null;
}): boolean {
  return isQaCatalogLabel(
    row.name_en,
    row.name_ar,
    row.slug,
    row.category?.name_en,
    row.category?.name_ar,
    row.category?.slug,
  );
}
