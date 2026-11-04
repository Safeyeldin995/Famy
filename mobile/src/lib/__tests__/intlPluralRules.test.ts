import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("react-native", () => ({
  I18nManager: { isRTL: true, allowRTL: vi.fn(), forceRTL: vi.fn() },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => "ar") },
}));

const nativePluralRules = Object.getOwnPropertyDescriptor(Intl, "PluralRules")!;
const nativeLocale = Object.getOwnPropertyDescriptor(Intl, "Locale")!;
afterEach(() => {
  Object.defineProperty(Intl, "PluralRules", nativePluralRules);
  Object.defineProperty(Intl, "Locale", nativeLocale);
});

it("bootstraps real Arabic and English i18next plurals when Hermes has no PluralRules", async () => {
  Reflect.deleteProperty(globalThis.Intl, "PluralRules");
  // Hermes also lacks Locale; our real app languages are exactly ar and en.
  Reflect.deleteProperty(globalThis.Intl, "Locale");
  expect("PluralRules" in Intl).toBe(false);
  await import("../intlPluralRules");
  const { default: i18n, initI18n } = await import("../i18n");
  await initI18n();
  expect(i18n.t("providerPage.reviewCount", { count: 2 })).toBe("تقييمين");
  expect(i18n.t("providerPage.reviewCount", { count: 3 })).toBe("3 تقييمات");
  expect(i18n.t("providerPage.reviewCount", { count: 0 })).toBe("مفيش تقييمات");
  await i18n.changeLanguage("en");
  expect(i18n.t("providerPage.reviewCount", { count: 1 })).toBe("1 review");
  expect(i18n.t("providerPage.reviewCount", { count: 3 })).toBe("3 reviews");
});

it("loads the polyfill before the router can import i18n or screens", () => {
  const entry = readFileSync(new URL("../../../index.js", import.meta.url), "utf8");
  expect(entry.indexOf('import "./src/lib/intlPluralRules"')).toBeLessThan(
    entry.indexOf('import "expo-router/entry"'),
  );
});
