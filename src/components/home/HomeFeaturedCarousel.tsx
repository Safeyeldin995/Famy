import { useTranslation } from "react-i18next";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { EmptyState } from "@/components/famio/ui";
import type { Provider } from "@/lib/mock/data";
import { formatEGP } from "@/lib/utils";

export function HomeFeaturedCarousel({ providers }: { providers: Provider[] }) {
  const { t } = useTranslation();
  if (!providers.length) return null;

  return (
    <section className="mt-8 px-5">
      <div className="mb-4">
        <p className="text-overline">{t("home.featuredSubtitle")}</p>
        <h2 className="text-title mt-1 text-foreground">{t("home.featured")}</h2>
      </div>
      <div className="space-y-2">
        {providers.map((provider) => (
          <ProviderListRow
            key={provider.id}
            to="/provider/$id"
            params={{ id: provider.id }}
            avatar={provider.avatar}
            name={provider.name}
            subtitle={formatEGP(provider.hourlyRate, { perHour: true })}
            meta={<ProviderRatingMeta rating={provider.rating} reviews={provider.reviews} />}
            pill={{ label: t("roles.topPro"), tone: "brand" }}
          />
        ))}
      </div>
    </section>
  );
}
