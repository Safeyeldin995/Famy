import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ICON_STROKE } from "@/lib/icons/constants";
import type { FeaturedPromoCode } from "@/lib/db/promo-codes-queries";
import { promoDescription, promoDiscountLabel } from "@/lib/promo/display";

async function copyPromoCode(code: string, t: ReturnType<typeof useTranslation>["t"]) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success(t("promoCodes.copied", { code }));
  } catch {
    toast.error(t("promoCodes.copyError"));
  }
}

export function HomePromoStrip({ offer }: { offer: FeaturedPromoCode }) {
  const { t, i18n } = useTranslation();
  const description = promoDescription(offer, i18n.language);
  const title = promoDiscountLabel(offer, t);

  return (
    <section className="mt-8 px-5">
      <div className="home-promo-block relative overflow-hidden rounded-[1.375rem] px-5 py-6 shadow-card">
        <div className="relative z-10 max-w-[70%]">
          <p className="text-overline text-muted-foreground">{t("home.offers.promoLabel")}</p>
          <p className="mt-2 text-[1.375rem] font-extrabold leading-tight text-foreground">{title}</p>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void copyPromoCode(offer.code, t)}
            aria-label={t("promoCodes.copyCode")}
            className="focus-ring tap-scale mt-4 inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-brand-foreground"
            dir="ltr"
          >
            {offer.code}
            <Copy className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        </div>
        <svg
          viewBox="0 0 120 120"
          className="pointer-events-none absolute -end-2 bottom-0 h-28 w-28 opacity-90"
          aria-hidden="true"
        >
          <circle cx="78" cy="42" r="16" fill="oklch(0.74 0.16 25 / 0.18)" />
          <rect x="52" y="62" width="36" height="28" rx="8" fill="oklch(0.74 0.16 25 / 0.14)" />
          <circle cx="64" cy="34" r="10" fill="oklch(0.74 0.16 25 / 0.35)" />
          <path d="M58 52c4-8 12-10 18-10s14 2 18 10" fill="oklch(0.74 0.16 25 / 0.28)" />
        </svg>
      </div>
    </section>
  );
}

export function HomePromos({ offers }: { offers: FeaturedPromoCode[] }) {
  if (offers.length === 0) return null;
  return (
    <>
      {offers.map((offer) => (
        <HomePromoStrip key={offer.id} offer={offer} />
      ))}
    </>
  );
}
