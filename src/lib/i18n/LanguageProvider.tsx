import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n, { applyDocumentLang, currentLang } from "./index";

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Ensure i18n module is imported and applied on mount
  useEffect(() => {
    applyDocumentLang(currentLang());
    const handler = (lng: string) => applyDocumentLang(lng === "ar" ? "ar" : "en");
    i18n.on("languageChanged", handler);
    return () => {
      i18n.off("languageChanged", handler);
    };
  }, []);
  // Force re-render subscription
  useTranslation();
  return <>{children}</>;
}
