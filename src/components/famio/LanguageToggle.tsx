import { useTranslation } from "react-i18next";
import { setLanguage, currentLang, type Lang } from "@/lib/i18n";
import { Languages } from "lucide-react";

export function LanguageToggle({ variant = "pill" }: { variant?: "pill" | "inline" }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language as Lang) === "ar" ? "ar" : "en";
  const next: Lang = lang === "ar" ? "en" : "ar";
  const click = () => setLanguage(next);

  if (variant === "inline") {
    return (
      <button
        onClick={click}
        aria-label={t("common.language")}
        className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-navy shadow-soft active:scale-95 transition-transform"
      >
        <Languages className="h-3.5 w-3.5" />
        {next === "ar" ? "العربية" : "English"}
      </button>
    );
  }

  return (
    <button
      onClick={click}
      aria-label={t("common.language")}
      className="focus-ring grid h-11 w-11 place-items-center rounded-2xl bg-surface text-navy shadow-soft active:scale-95 transition-transform"
      title={t("common.language")}
    >
      <span className="text-[11px] font-extrabold">{lang === "ar" ? "EN" : "ع"}</span>
    </button>
  );
}

/** Reads current language for callers; safe SSR fallback. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.language as Lang) === "ar" ? "ar" : "en";
}

export { currentLang };
