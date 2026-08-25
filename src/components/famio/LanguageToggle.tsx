import { useTranslation } from "react-i18next";
import { setLanguage, currentLang, type Lang } from "@/lib/i18n";
import { Languages } from "lucide-react";

export function LanguageToggle({ variant = "pill" }: { variant?: "pill" | "inline" | "hero" }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language as Lang) === "ar" ? "ar" : "en";
  const next: Lang = lang === "ar" ? "en" : "ar";
  const click = () => setLanguage(next);
  const targetShort = next === "ar" ? t("common.langShortAr") : t("common.langShortEn");
  const switchLabel = next === "ar" ? t("common.switchToArabic") : t("common.switchToEnglish");

  if (variant === "hero") {
    return (
      <button
        type="button"
        onClick={click}
        aria-label={switchLabel}
        className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm active:scale-95 transition-transform"
      >
        <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-[1.25rem] text-center leading-none">{targetShort}</span>
      </button>
    );
  }

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={click}
        aria-label={switchLabel}
        className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-ink shadow-soft active:scale-95 transition-transform"
      >
        <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-[1.25rem] text-center leading-none">{targetShort}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={click}
      aria-label={switchLabel}
      className="focus-ring grid h-11 w-11 place-items-center rounded-2xl bg-surface text-ink shadow-soft active:scale-95 transition-transform"
      title={switchLabel}
    >
      <span className="text-[11px] font-extrabold leading-none">{lang === "ar" ? t("common.langShortEn") : t("common.langShortAr")}</span>
    </button>
  );
}

/** Reads current language for callers; safe SSR fallback. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.language as Lang) === "ar" ? "ar" : "en";
}

export { currentLang };
