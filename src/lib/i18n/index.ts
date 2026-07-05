import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import ar from "./locales/ar";

export type Lang = "en" | "ar";

const STORAGE_KEY = "famio.lang";

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "ar" ? "ar" : "en";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: readStoredLang(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function applyDocumentLang(lang: Lang) {
  if (typeof document === "undefined") return;
  const dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  document.documentElement.dataset.lang = lang;
}

export function setLanguage(lang: Lang) {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, lang);
  i18n.changeLanguage(lang);
  applyDocumentLang(lang);
}

export function currentLang(): Lang {
  return (i18n.language as Lang) === "ar" ? "ar" : "en";
}

export default i18n;
