import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PhoneFrame, Chip, EmptyState } from "@/components/famio/ui";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { useAddresses, useMarketplaceServices, useProviders } from "@/lib/db/queries";
import { toUIProvider } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X } from "lucide-react";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP, formatNumber } from "@/lib/utils";

export const Route = createFileRoute("/search")({ component: SearchPage });

type Filter = "all" | "home-cleaning" | "babysitting" | "top";

function SearchPage() {
  const { t } = useTranslation();
  const lang = currentLang();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [serviceId, setServiceId] = useState("");
  const [addressId, setAddressId] = useState("");
  const servicesQ = useMarketplaceServices();
  const addressesQ = useAddresses();
  const selectedAddressId = addressId || (addressesQ.data ?? []).find((a) => a.is_default)?.id || addressesQ.data?.[0]?.id;
  const provsQ = useProviders({ serviceId: serviceId || undefined, addressId: selectedAddressId, limit: 60 });

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (provsQ.data ?? []).map(toUIProvider);
    return list.filter((p) => {
      if (filter === "home-cleaning" && p.categorySlug !== "home-cleaning") return false;
      if (filter === "babysitting" && p.categorySlug !== "babysitting") return false;
      if (filter === "top" && p.rating < 4.85) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.bio ?? "").toLowerCase().includes(term) ||
        p.areas.some((a) => a.toLowerCase().includes(term))
      );
    });
  }, [q, filter, provsQ.data]);

  return (
    <PhoneFrame bg="bg-background">
      <div className="safe-top px-5 pb-4 pt-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("search.title")}</h1>
        <div className="mt-5 flex h-14 items-center gap-3 rounded-full border border-border/70 bg-surface px-5 shadow-sm focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search2.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-bold outline-none placeholder:text-muted-foreground placeholder:font-semibold"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label={t("common.cancel")}
              className="focus-ring tap-scale grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-10 pt-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>{t("common.seeAll")}</Chip>
          <Chip active={filter === "home-cleaning"} onClick={() => setFilter("home-cleaning")}>{t("categories.homeTitle")}</Chip>
          <Chip active={filter === "babysitting"} onClick={() => setFilter("babysitting")}>{t("categories.kidsTitle")}</Chip>
          <Chip active={filter === "top"} onClick={() => setFilter("top")}>{t("category.sortTop")}</Chip>
        </div>

        <div className="mt-5 rounded-[2rem] border border-border/50 bg-surface-elevated p-4 shadow-sm grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">{t("search2.service")}</span>
            <select
              aria-label={t("search2.service")}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="focus-ring mt-1.5 h-12 w-full rounded-xl bg-surface-2 px-3 text-sm font-bold text-foreground focus:outline-none"
            >
              <option value="">{t("search2.allServices")}</option>
              {(servicesQ.data ?? []).map((service: any) => (
                <option key={service.id} value={service.id}>
                  {lang === "ar" ? service.name_ar || service.name_en : service.name_en || service.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">{t("search2.address")}</span>
            <select
              aria-label={t("search2.address")}
              value={selectedAddressId ?? ""}
              onChange={(e) => setAddressId(e.target.value)}
              className="focus-ring mt-1.5 h-12 w-full rounded-xl bg-surface-2 px-3 text-sm font-bold text-foreground focus:outline-none"
            >
              {(addressesQ.data ?? []).map((address) => (
                <option key={address.id} value={address.id}>{address.area || address.city}</option>
              ))}
            </select>
          </label>
        </div>

        {!provsQ.isLoading && !provsQ.isError && results.length > 0 ? (
          <p className="mt-6 text-sm font-extrabold tracking-tight text-foreground">{t("search2.resultsCount", { count: formatNumber(results.length) })}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {provsQ.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />)
          ) : provsQ.isError ? (
            <EmptyState icon="alert" title={t("common.errorTitle")} body={t("common.tryAgain")} />
          ) : results.length === 0 ? (
            <EmptyState icon="search" title={t("search2.noResults")} body={t("search2.noResultsBody")} />
          ) : (
            results.map((p) => (
              <ProviderListRow
                key={p.id}
                to="/provider/$id"
                params={{ id: p.id }}
                avatar={p.avatar}
                name={p.name}
                subtitle={formatEGP(p.hourlyRate, { perHour: true })}
                meta={<ProviderRatingMeta rating={p.rating} reviews={p.reviews} />}
                pill={p.rating >= 4.9 ? { label: t("roles.topPro"), tone: "brand" } : undefined}
              />
            ))
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}
