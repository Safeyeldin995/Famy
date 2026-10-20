import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
// Same strings as the web app, so copy stays identical across platforms.
import en from "@shared/i18n/locales/en";
import ar from "@shared/i18n/locales/ar";

export type AppLanguage = "ar" | "en";

const STORAGE_KEY = "famy.lang";

/** Arabic is the default for Egypt; English only when chosen or the device is English. */
async function detectLanguage(): Promise<AppLanguage> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    // storage unavailable: fall through to the device language
  }
  return getLocales()[0]?.languageCode === "en" ? "en" : "ar";
}

export async function initI18n(): Promise<AppLanguage> {
  const lng = await detectLanguage();
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  applyDirection(lng);
  return lng;
}

/**
 * React Native fixes layout direction at startup. Returns true when the
 * direction changed and the app must reload for it to apply.
 */
export function applyDirection(lng: AppLanguage): boolean {
  const rtl = lng === "ar";
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

export async function saveLanguage(lng: AppLanguage) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore: the choice just won't persist
  }
}

export default i18n;
