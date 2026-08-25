import { Link } from "@tanstack/react-router";
import { ShieldCheck, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/famio/ui";
import type { Provider } from "@/lib/mock/data";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP, formatNumber } from "@/lib/utils";

export function HomeFeaturedCarousel({ providers }: { providers: Provider[] }) {
  const { t } = useTranslation();
  if (!providers.length) return null;

  return (
    <section className="mt-2">
      <div className="mb-4 flex items-end justify-between px-5">
        <div>
          <p className="text-overline">{t("home.featuredSubtitle", "Top rated")}</p>
          <h2 className="text-title mt-1 text-foreground">{t("home.featured")}</h2>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar snap-x snap-mandatory">
        <div className="flex gap-4 px-5 pb-2">
          {providers.map((provider) => (
            <Link
              key={provider.id}
              to="/provider/$id"
              params={{ id: provider.id }}
              aria-label={`${provider.name}, ${provider.rating} stars`}
              className="focus-ring tap-scale relative block w-[15.5rem] shrink-0 snap-start overflow-hidden rounded-[1.375rem] bg-ink shadow-card"
            >
              <div className="relative h-52 w-full">
                <Avatar src={provider.avatar} alt={provider.name} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
                <div className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" strokeWidth={ICON_STROKE_BOLD} />
                  {formatNumber(provider.rating)}
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-base font-bold">{provider.name}</p>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
                </div>
                <p className="mt-1 text-sm font-semibold text-white/85">
                  {formatEGP(provider.hourlyRate, { perHour: true })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
