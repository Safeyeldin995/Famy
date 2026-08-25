import { Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";

type PromoOffer = {
  id: string;
  code: string;
};

export function HomePromoStrip({ offer }: { offer: PromoOffer }) {
  const { t } = useTranslation();

  return (
    <section className="mt-8 px-5">
      <article className="tap-scale overflow-hidden rounded-2xl bg-brand p-[1px] shadow-sm">
        <div className="flex items-center gap-4 rounded-[calc(var(--radius-2xl)-1px)] bg-surface px-4 py-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand">
            <Tag className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">
            {t(`home.offers.${offer.id}Title`)}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t(`home.offers.${offer.id}Subtitle`)}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-foreground"
            dir="ltr"
          >
            {offer.code}
          </span>
        </div>
      </article>
    </section>
  );
}
