import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

type PromoOffer = {
  id: string;
  code: string;
  gradient: string;
  title: string;
  subtitle: string;
};

export function HomePromos({ offers }: { offers: PromoOffer[] }) {
  const { t } = useTranslation();

  return (
    <div className="mt-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
      <div className="flex gap-4 px-5 pb-1">
        {offers.map((offer) => (
          <article
            key={offer.id}
            className={`snap-start w-[17.5rem] shrink-0 overflow-hidden rounded-[1.375rem] bg-gradient-to-br ${offer.gradient} p-5 text-white shadow-card`}
          >
            <Sparkles className="h-5 w-5 opacity-90" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-extrabold leading-snug tracking-tight">
              {t(`home.offers.${offer.id}Title`, offer.title)}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-white/85">
              {t(`home.offers.${offer.id}Subtitle`, offer.subtitle)}
            </p>
            <div
              className="mt-5 inline-flex min-h-11 items-center rounded-full bg-white/15 px-3.5 py-2 text-xs font-bold tracking-wide backdrop-blur-sm"
              dir="ltr"
            >
              {offer.code}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
