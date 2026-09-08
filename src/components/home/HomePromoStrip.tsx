import { Copy, Tag } from "lucide-react";
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
    <div className="home-ink-panel relative w-[17rem] shrink-0 snap-start overflow-hidden rounded-[1.75rem] px-5 py-5 shadow-card">
      <div className="relative z-10">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white/85">
          <Tag className="h-3 w-3" strokeWidth={ICON_STROKE} aria-hidden="true" />
          {t("home.offers.promoLabel")}
        </span>
        <p className="mt-3 text-[1.25rem] font-extrabold leading-tight">{title}</p>
        {description ? (
          <p className="mt-1.5 line-clamp-2 text-xs opacity-75">{description}</p>
        ) : null}
        <button
          type="button"
          onClick={() => void copyPromoCode(offer.code, t)}
          aria-label={t("promoCodes.copyCode")}
          className="focus-ring tap-scale mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground"
          dir="ltr"
        >
          {offer.code}
          <Copy className="h-3.5 w-3.5" strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </div>
      <span
        className="pointer-events-none absolute -end-8 -top-8 h-28 w-28 rounded-full bg-brand/30 blur-xl"
        aria-hidden="true"
      />
    </div>
  );
}

export function HomePromos({ offers }: { offers: FeaturedPromoCode[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 no-scrollbar">
      {offers.map((offer) => (
        <HomePromoStrip key={offer.id} offer={offer} />
      ))}
    </section>
  );
}
