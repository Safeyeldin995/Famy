import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import ar from "./locales/ar";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { languageCookie, readLanguageCookie } from "./languageCookie";

export type Lang = "en" | "ar";

const STORAGE_KEY = "famio.lang";

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "en";
  // Match the SSR document first; migrate localStorage only after hydration.
  const rendered = document.documentElement.dataset.lang;
  if (rendered === "ar" || rendered === "en") return rendered;
  return readLanguageCookie(document.cookie) ?? "en";
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
  if (typeof document !== "undefined") document.cookie = languageCookie(lang);
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, lang);
  } catch { /* Cookie persistence still works when localStorage is blocked. */ }
  i18n.changeLanguage(lang);
  applyDocumentLang(lang);
}

export const currentLang = createIsomorphicFn()
  .server((): Lang => {
    try {
      return readLanguageCookie(getRequestHeader("cookie") ?? "") ?? "en";
    } catch {
      // Non-request consumers such as unit tests retain the existing API.
      return i18n.language === "ar" ? "ar" : "en";
    }
  })
  .client((): Lang => i18n.language === "ar" ? "ar" : "en");

export default i18n;
