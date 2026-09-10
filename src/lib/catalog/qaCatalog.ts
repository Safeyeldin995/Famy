/** QA fixture names use a literal `QA_` / `QA ` prefix. Real catalog rows do not. */
const QA_LABEL_RE = /^QA[_\s]/i;

export function isQaCatalogLabel(...names: Array<string | null | undefined>): boolean {
  return names.some((name) => QA_LABEL_RE.test((name ?? "").trim()));
}
