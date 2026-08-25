import { Link } from "@tanstack/react-router";
import { ChevronRight, ShieldCheck, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/famio/ui";
import type { Provider } from "@/lib/mock/data";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP, formatNumber } from "@/lib/utils";

export function HomeFeaturedCarousel({ providers }: { providers: Provider[] }) {
  const { t } = useTranslation();
  if (!providers.length) return null;

  return (
    <section className="mt-4">
      <div className="mb-4 flex items-end justify-between px-5">
        <div>
          <p className="text-overline">{t("home.featuredSubtitle", "Top rated")}</p>
          <h2 className="text-title mt-1 text-foreground">{t("home.featured")}</h2>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar snap-x snap-mandatory">
        <div className="flex gap-3 px-5 pb-2">
          {providers.map((provider) => (
            <Link
              key={provider.id}
              to="/provider/$id"
              params={{ id: provider.id }}
              aria-label={`${provider.name}, ${provider.rating} stars`}
              className="focus-ring tap-scale surface-card block w-[14.5rem] shrink-0 snap-start overflow-hidden shadow-xs"
            >
              <div className="relative h-40 w-full">
                <Avatar src={provider.avatar} alt={provider.name} className="h-full w-full" />
                <div className="absolute start-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-1 text-[11px] font-bold text-foreground shadow-xs backdrop-blur-sm">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" strokeWidth={ICON_STROKE_BOLD} />
                  {formatNumber(provider.rating)}
                </div>
              </div>
              <div className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="truncate text-sm font-bold text-foreground">{provider.name}</p>
                    <ShieldCheck
                      className="h-3.5 w-3.5 shrink-0 text-brand"
                      strokeWidth={ICON_STROKE_BOLD}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-brand">
                    {formatEGP(provider.hourlyRate, { perHour: true })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
