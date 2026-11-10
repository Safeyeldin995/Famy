import { describe, expect, it } from "vitest";
import ar from "../locales/ar";
import en from "../locales/en";
import {
  baseKeyForPlural,
  collectAllReferencedKeys,
  collectDynamicPrefixes,
  compareLocaleKeySets,
  flattenTranslationKeys,
  hasLocaleKey,
  listTranslationSourceFiles,
} from "../collectTranslationUsage";

describe("i18n locale completeness", () => {
  const enFlat = flattenTranslationKeys(en);
  const arFlat = flattenTranslationKeys(ar);
  const enKeys = new Set(enFlat.keys());
  const arKeys = new Set(arFlat.keys());
  const sourceFiles = listTranslationSourceFiles();

  it("keeps Arabic and English locale key sets identical", () => {
    const { onlyEn, onlyAr } = compareLocaleKeySets(enKeys, arKeys);
    const pluralBase = (keys: string[]) => new Set(keys.map(baseKeyForPlural));
    const enOnlyLogical = onlyEn.filter((k) => !pluralBase(onlyAr).has(baseKeyForPlural(k)));
    const arOnlyLogical = onlyAr.filter((k) => !pluralBase(onlyEn).has(baseKeyForPlural(k)));
    expect(
      { onlyEn: enOnlyLogical, onlyAr: arOnlyLogical },
      [
        onlyEn.length || onlyAr.length
          ? `Locale key mismatch (${onlyEn.length} only in en, ${onlyAr.length} only in ar)`
          : "",
        ...enOnlyLogical.slice(0, 40).map((k) => `  en only: ${k}`),
        ...arOnlyLogical.slice(0, 40).map((k) => `  ar only: ${k}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ).toEqual({ onlyEn: [], onlyAr: [] });
  });

  it("defines every statically referenced translation key in both locales", () => {
    const used = collectAllReferencedKeys(sourceFiles);

    const missingEn: string[] = [];
    const missingAr: string[] = [];
    for (const key of [...used].sort()) {
      if (!hasLocaleKey(enKeys, key)) missingEn.push(key);
      if (!hasLocaleKey(arKeys, key)) missingAr.push(key);
    }

    expect(
      { missingEn, missingAr },
      [
        missingEn.length || missingAr.length ? "Missing translation keys for code references:" : "",
        ...missingEn.slice(0, 50).map((k) => `  missing en: ${k}`),
        ...missingAr.slice(0, 50).map((k) => `  missing ar: ${k}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ).toEqual({ missingEn: [], missingAr: [] });
  });

  it("documents dynamic translation prefixes (informational)", () => {
    const dynamic = collectDynamicPrefixes(sourceFiles);
    const unique = [...new Set(dynamic.map((d) => d.prefix))].sort();
    expect(unique.length).toBeGreaterThan(0);
  });
});
