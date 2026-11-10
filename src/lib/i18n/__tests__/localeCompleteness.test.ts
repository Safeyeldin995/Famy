import { describe, expect, it } from "vitest";
import ar from "../locales/ar";
import en from "../locales/en";
import {
  baseKeyForPlural,
  collectAllReferencedKeys,
  collectDynamicPrefixes,
  collectUnresolvedDynamicTemplates,
  compareLocaleKeySets,
  flattenTranslationKeys,
  hasLocaleKey,
  listTranslationSourceFiles,
  pluralSuffixesPresent,
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

  it("keeps plural suffix sets aligned between Arabic and English", () => {
    const pluralBases = new Set<string>();
    for (const key of enKeys) {
      if (pluralSuffixesPresent(enKeys, baseKeyForPlural(key)).length > 0) {
        pluralBases.add(baseKeyForPlural(key));
      }
    }
    for (const base of [...pluralBases].sort()) {
      const enForms = pluralSuffixesPresent(enKeys, base).sort();
      const arForms = pluralSuffixesPresent(arKeys, base).sort();
      expect(enForms, `Plural forms differ for ${base}`).toEqual(arForms);
      if (enForms.length > 0) {
        expect(enKeys.has(`${base}_other`), `${base}_other missing in en`).toBe(true);
        expect(arKeys.has(`${base}_other`), `${base}_other missing in ar`).toBe(true);
      }
    }
  });

  it("defines every referenced translation key in both locales", () => {
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

  it("resolves known dynamic and underscore keys used on web and mobile", () => {
    const used = collectAllReferencedKeys(sourceFiles);
    for (const key of [
      "providerDocuments.id_card_front",
      "familyMembers.genders.male",
      "familyMembers.genders.female",
      "addresses.label.home",
      "addresses.label.work",
    ]) {
      expect(used.has(key), `collector missed ${key}`).toBe(true);
    }
  });

  it("resolves critical finite dynamic template keys (Codex regression)", () => {
    const unresolved = collectUnresolvedDynamicTemplates(sourceFiles);
    const criticalPrefixes = [
      "familyMembers.genders",
      "addresses.label",
      "providerSetup.relationships",
    ];
    const critical = unresolved.filter((u) =>
      criticalPrefixes.some((p) => u.prefix === p || u.prefix.startsWith(`${p}.`)),
    );
    expect(
      critical,
      critical.map((u) => `${u.file}: \`${u.prefix}.\${${u.varName}}\``).join("\n"),
    ).toEqual([]);
  });

  it("documents dynamic translation prefixes (informational)", () => {
    const dynamic = collectDynamicPrefixes(sourceFiles);
    const unique = [...new Set(dynamic.map((d) => d.prefix))].sort();
    expect(unique.length).toBeGreaterThan(0);
  });
});
