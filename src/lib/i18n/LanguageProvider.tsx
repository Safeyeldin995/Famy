import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n, { applyDocumentLang, setLanguage, type Lang } from "./index";
import { readLanguageCookie } from "./languageCookie";

export function LanguageProvider({ children, initialLanguage = "en" }: { children: ReactNode; initialLanguage?: Lang }) {
  const [instance] = useState(() => {
    if (typeof window === "undefined") {
      return i18n.cloneInstance({ lng: initialLanguage, initImmediate: false });
    }
    // Bundled resources initialize synchronously before the first client render.
    i18n.changeLanguage(initialLanguage);
    return i18n;
  });
  useEffect(() => {
    if (!readLanguageCookie(document.cookie)) {
      try {
        const saved = window.localStorage.getItem("famio.lang");
        if (saved === "ar" || saved === "en") setLanguage(saved);
      } catch { /* Storage may be unavailable in privacy mode. */ }
    }
    applyDocumentLang(instance.language === "ar" ? "ar" : "en");
    const handler = (lng: string) => applyDocumentLang(lng === "ar" ? "ar" : "en");
    instance.on("languageChanged", handler);
    return () => {
      instance.off("languageChanged", handler);
    };
  }, [instance]);
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}
