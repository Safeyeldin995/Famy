import { previewPath } from "@/lib/preview/previewPath";
import { isFixedPackage, packageLabel, type PackageService } from "@/lib/pricing/servicePackages";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PhoneFrame, Chip, EmptyState } from "@/components/famio/ui";
import { CustomerPageHeader as CustomerPageHero } from "@/components/famio/CustomerPageHeader";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { customerProviders } from "@/components/famio/customerProviders";
import { QueryError } from "@/components/famio/QueryError";

import { useAddresses, useMarketplaceServices, useProviders } from "@/lib/db/queries";
import { useApprovedTeachingCapabilitiesForProviders } from "@/lib/db/teaching-queries";
import {
  formatTeachingCapabilityLine,
  isTutoringCategorySlug,
} from "@/lib/tutoring/teachingCapabilities";
import { providerPriceLabel } from "@/lib/db/adapters";
import { currentLang } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, X } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatNumber } from "@/lib/format";

export function searchServiceFilter(search: Record<string, unknown>): { serviceId?: string } {
  return typeof search.serviceId === "string" ? { serviceId: search.serviceId } : {};
}
export const Route = createFileRoute("/search")({ validateSearch: searchServiceFilter, component: SearchPage });

type Filter = "all" | "babysitting" | "tutoring" | "top";

function SearchPage() {
  const { t } = useTranslation();
  const lang = currentLang();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const search = useSearch({ strict: false });
  const [serviceId, setServiceId] = useState(search.serviceId ?? "");
  const [addressId, setAddressId] = useState("");
  const servicesQ = useMarketplaceServices();
  const addressesQ = useAddresses();
  const selectedAddressId =
    addressId || (addressesQ.data ?? []).find((a) => a.is_default)?.id || addressesQ.data?.[0]?.id;
  const babysittersQ = useProviders({ categorySlug: "babysitting", serviceId: serviceId || undefined, addressId: selectedAddressId, limit: 60 });
  const teachersQ = useProviders({ categorySlug: "tutoring", serviceId: serviceId || undefined, addressId: selectedAddressId, limit: 60 });
  const provsQ = {
    isLoading: babysittersQ.isLoading || teachersQ.isLoading,
    isError: babysittersQ.isError || teachersQ.isError,
    refetch: () => Promise.all([babysittersQ.refetch(), teachersQ.refetch()]),
  };

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = customerProviders(filter === "tutoring"
      ? [...(teachersQ.data ?? []), ...(babysittersQ.data ?? [])]
      : [...(babysittersQ.data ?? []), ...(teachersQ.data ?? [])]);
    return list.filter((p) => {
      if (filter === "babysitting" && !p.categorySlugs.includes("babysitting")) return false;
      if (filter === "tutoring" && !p.categorySlugs.includes("tutoring")) return false;
      if (filter === "top" && p.rating < 4.85) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.bio ?? "").toLowerCase().includes(term) ||
        p.areas.some((a) => a.toLowerCase().includes(term))
      );
    });
  }, [q, filter, babysittersQ.data, teachersQ.data]);
  const capabilityRows = useApprovedTeachingCapabilitiesForProviders(results.map((p) => p.id));

  const recoveryActions = <div className="flex flex-wrap justify-center gap-2">
    <button type="button" className="min-h-11 px-3 font-bold text-brand" onClick={() => { setQ(""); setFilter("all"); setServiceId(""); }}>{t("bookingUx.clearFilters")}</button>
    <button type="button" className="min-h-11 px-3 font-bold text-brand" onClick={() => document.getElementById("search-address")?.focus()}>{t("bookingUx.changeArea")}</button>
    <Link to={previewPath("/addresses/new") as "/addresses/new"} className="inline-flex min-h-11 items-center px-3 font-bold text-brand">{t("addresses.addAddress")}</Link>
  </div>;
  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero title={t("search.title")} subtitle={t("home.headline")} backTo="/home" />

      <div className="px-5">
        <div className="mt-4 rounded-2xl border border-border/60 p-3 focus-within:border-brand">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[1.125rem] bg-brand text-brand-foreground">
              <SearchIcon className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("customerSearch.placeholder")}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-pro-14 font-bold outline-none placeholder:font-semibold placeholder:text-muted-foreground"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label={t("common.cancel")}
                className="focus-ring tap-scale grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-5 pb-10 pt-5">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            {t("common.seeAll")}
          </Chip>
          <Chip active={filter === "babysitting"} onClick={() => setFilter("babysitting")}>
            {t("categories.kidsTitle")}
          </Chip>
          <Chip active={filter === "tutoring"} onClick={() => setFilter("tutoring")}>
            {t("categories.tutorTitle")}
          </Chip>
          <Chip active={filter === "top"} onClick={() => setFilter("top")}>
            {t("category.sortTop")}
          </Chip>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-border/50 bg-white p-4 shadow-sm">
          <label className="block">
            <span className="text-pro-12 font-bold">{t("search2.service")}</span>
            <select
              aria-label={t("search2.service")}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="focus-ring mt-1.5 h-12 w-full rounded-full bg-surface-2 px-4 text-pro-14 font-bold text-foreground focus:outline-none"
            >
              <option value="">{t("search2.allServices")}</option>
              {(servicesQ.data ?? []).map(
                (service: { id: string; name_en: string; name_ar: string } & PackageService) => (
                  <option key={service.id} value={service.id}>
                    {lang === "ar"
                      ? service.name_ar || service.name_en
                      : service.name_en || service.name_ar}{isFixedPackage(service) ? ` · ${t(packageLabel(service).key, packageLabel(service).values)}` : ""}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-pro-12 font-bold">{t("search2.address")}</span>
            <select
              id="search-address"
              aria-label={t("search2.address")}
              value={selectedAddressId ?? ""}
              onChange={(e) => setAddressId(e.target.value)}
              className="focus-ring mt-1.5 h-12 w-full rounded-full bg-surface-2 px-4 text-pro-14 font-bold text-foreground focus:outline-none"
            >
              {(addressesQ.data ?? []).map((address) => (
                <option key={address.id} value={address.id}>
                  {address.area || address.city}
                </option>
              ))}
            </select>
          </label>
        </div>

        {servicesQ.isError && <QueryError compact onRetry={() => servicesQ.refetch()} />}
        {addressesQ.isError && <QueryError compact onRetry={() => addressesQ.refetch()} />}
        {!provsQ.isLoading && !provsQ.isError && results.length > 0 ? (
          <p className="mt-6 text-pro-14 font-extrabold tracking-tight text-foreground">
            {t("customerSearch.results", { value: formatNumber(results.length) })}
          </p>
        ) : null}

        <div className="mt-4 space-y-2.5">
          {!addressesQ.isLoading && !selectedAddressId ? <EmptyState icon="search" title={t("customerHome.chooseArea")} body={t("customerHome.addressHint")} action={<Link to={previewPath("/addresses/new")} className="focus-ring inline-flex min-h-11 items-center text-pro-14 font-bold text-brand">{t("addresses.addAddress")}</Link>} /> : provsQ.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
            ))
          ) : provsQ.isError ? (
            <EmptyState icon="alert" title={t("common.errorTitle")} body={t("common.tryAgain")} action={<div><button type="button" className="min-h-11 px-4 font-bold text-brand" onClick={() => void provsQ.refetch()}>{t("common.retry")}</button>{recoveryActions}</div>} />
          ) : results.length === 0 ? (
            <EmptyState
              icon="search"
              title={t("search2.noResults")}
              body={t("search2.noResultsBody")}
              action={recoveryActions}
            />
          ) : (
            results.map((p) => {
              const cap = (capabilityRows.data ?? []).find((row) => row.providerId === p.id);
              const subtitle =
                p.categorySlugs.includes("tutoring") && filter === "tutoring" && cap
                  ? formatTeachingCapabilityLine({
                      subject: lang === "ar" ? cap.subjectNameAr : cap.subjectNameEn,
                      curriculum: lang === "ar" ? cap.curriculumNameAr : cap.curriculumNameEn,
                      level: lang === "ar" ? cap.levelNameAr : cap.levelNameEn,
                      durationMin: cap.durationMin,
                      price: cap.price,
                    })
                  : providerPriceLabel(p, t);
              return (
                <ProviderCard key={p.id} p={p} subtitle={subtitle} />
              );
            })
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}
