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
      <div className="home-ink-panel safe-top px-5 pb-8 pt-3 text-ink-foreground">
        <h1 className="text-[1.5rem] font-extrabold leading-tight text-white">{t("search.title")}</h1>
        <div className="mt-5 flex min-h-[3.75rem] items-center gap-3 rounded-[1.125rem] bg-white px-4 text-ink shadow-[0_16px_48px_-20px_oklch(0_0_0_/_0.55)]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/12">
            <SearchIcon className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search2.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label={t("common.cancel")}
              className="focus-ring tap-scale grid h-10 w-10 min-h-10 min-w-10 place-items-center rounded-xl bg-muted text-muted-foreground"
            >
              <X className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="-mt-5 rounded-t-[2rem] bg-background px-5 pb-10 pt-6">
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>{t("common.seeAll")}</Chip>
          <Chip active={filter === "home-cleaning"} onClick={() => setFilter("home-cleaning")}>{t("categories.homeTitle")}</Chip>
          <Chip active={filter === "babysitting"} onClick={() => setFilter("babysitting")}>{t("categories.kidsTitle")}</Chip>
          <Chip active={filter === "top"} onClick={() => setFilter("top")}>{t("category.sortTop")}</Chip>
        </div>

        <div className="surface-card mt-4 grid grid-cols-2 gap-3 p-3">
          <label className="block">
            <span className="text-overline">{t("search2.service")}</span>
            <select
              aria-label={t("search2.service")}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-medium text-foreground"
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
            <span className="text-overline">{t("search2.address")}</span>
            <select
              aria-label={t("search2.address")}
              value={selectedAddressId ?? ""}
              onChange={(e) => setAddressId(e.target.value)}
              className="focus-ring mt-1.5 h-11 w-full rounded-xl border border-border/80 bg-background px-3 text-sm font-medium text-foreground"
            >
              {(addressesQ.data ?? []).map((address) => (
                <option key={address.id} value={address.id}>{address.area || address.city}</option>
              ))}
            </select>
          </label>
        </div>

        {!provsQ.isLoading && !provsQ.isError && results.length > 0 ? (
          <p className="text-overline mt-6">{t("search2.resultsCount", { count: formatNumber(results.length) })}</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {provsQ.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[4.75rem] animate-pulse rounded-[1.25rem] bg-muted" />)
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
