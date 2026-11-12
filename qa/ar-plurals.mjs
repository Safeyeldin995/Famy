import fs from "node:fs";

const REQUIRED_AR_SUFFIXES = ["_one", "_two", "_few", "_many", "_other"];

/**
 * Arabic UI copy in ar.ts must define full i18next plural sets so counts like 52
 * do not fall back to English.
 */
export function checkArabicLocalePlurals({ arTsPath }) {
  const source = fs.readFileSync(arTsPath, "utf8");
  const keyPattern = /^\s*([A-Za-z][\w]*)_((?:zero|one|two|few|many|other)):/gm;
  const pluralBases = new Set();
  const present = new Map();

  for (const match of source.matchAll(keyPattern)) {
    const base = match[1];
    const suffix = `_${match[2]}`;
    pluralBases.add(base);
    const set = present.get(base) ?? new Set();
    set.add(suffix);
    present.set(base, set);
  }

  const missing = [];
  for (const base of [...pluralBases].sort()) {
    const forms = present.get(base) ?? new Set();
    if (!forms.has("_one") && !forms.has("_other")) continue;
    for (const suffix of REQUIRED_AR_SUFFIXES) {
      if (!forms.has(suffix)) {
        missing.push(`${base}${suffix}`);
      }
    }
  }

  if (missing.length === 0) {
    return { ok: true, message: "Arabic locale plural forms are complete" };
  }

  return {
    ok: false,
    message: `Arabic locale is missing ${missing.length} plural form(s)`,
    missing,
  };
}
