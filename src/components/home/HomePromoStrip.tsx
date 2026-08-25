import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_STROKE } from "@/lib/icons/constants";

type PromoOffer = {
  id: string;
  code: string;
};

export function HomePromoStrip({ offer }: { offer: PromoOffer }) {
  const { t } = useTranslation();

  return (
    <section className="mt-8 px-5">
      <Link
        to="/search"
        className="focus-ring tap-scale home-promo-block relative block overflow-hidden rounded-[1.375rem] px-5 py-6 text-ink-foreground shadow-card"
      >
        <div className="relative z-10 max-w-[70%]">
          <p className="text-overline text-white/70">{t("home.offers.promoLabel")}</p>
          <p className="mt-2 text-[1.375rem] font-extrabold leading-tight text-white">
            {t(`home.offers.${offer.id}Title`)}
          </p>
          <p className="mt-2 text-sm text-white/80">{t(`home.offers.${offer.id}Subtitle`)}</p>
          <span
            className="mt-4 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-brand"
            dir="ltr"
          >
            {offer.code}
            <ArrowUpRight className="h-3.5 w-3.5 rtl-flip" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </span>
        </div>
        <svg
          viewBox="0 0 120 120"
          className="pointer-events-none absolute -end-2 bottom-0 h-28 w-28 opacity-90"
          aria-hidden="true"
        >
          <circle cx="78" cy="42" r="16" fill="white" fillOpacity="0.18" />
          <rect x="52" y="62" width="36" height="28" rx="8" fill="white" fillOpacity="0.14" />
          <circle cx="64" cy="34" r="10" fill="#FFD59A" fillOpacity="0.85" />
          <path d="M58 52c4-8 12-10 18-10s14 2 18 10" fill="#FFB4C4" fillOpacity="0.8" />
        </svg>
      </Link>
    </section>
  );
}
