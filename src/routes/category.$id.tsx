import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneFrame, TopBar, Chip, EmptyState } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { useCategories, useMarketplaceServices, useProviders } from "@/lib/db/queries";
import { toUICategory, toUIProvider } from "@/lib/db/adapters";
import { formatEGP, formatNumber } from "@/lib/utils";
import { Filter, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/category/$id")({ component: CategoryPage });

function CategoryPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const catsQ = useCategories();
  const servicesQ = useMarketplaceServices(id);
  const [serviceId, setServiceId] = useState("");
  useEffect(() => {
    if (!serviceId && servicesQ.data?.[0]?.id) setServiceId(servicesQ.data[0].id);
  }, [serviceId, servicesQ.data]);
  const provsQ = useProviders({ categorySlug: id, serviceId: serviceId || undefined, limit: 50 });
  const [sort, setSort] = useState<"top" | "price" | "experience">("top");

  const cat = useMemo(() => {
    const row = (catsQ.data ?? []).find((c: any) => c.slug === id);
    return row ? toUICategory(row) : null;
  }, [catsQ.data, id]);

  const list = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data]);
  const sorted = [...list].sort((a, b) =>
    sort === "price" ? a.hourlyRate - b.hourlyRate :
    sort === "experience" ? b.yearsExp - a.yearsExp :
    b.rating - a.rating
  );

  return (
    <PhoneFrame bg="bg-background">
      <div className="safe-top px-5 pb-5">
        <TopBar
          back={{ to: "/home" }}
          right={(
            <button
              aria-label={t("category.filters")}
              className="focus-ring tap-scale grid h-11 w-11 place-items-center rounded-full bg-brand/8 text-brand"
            >
              <Filter className="h-4 w-4" />
            </button>
          )}
          transparent
        />
        <div className="mt-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-brand">{cat?.subtitle ?? ""}</div>
          <h1 className="mt-1 text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground">{cat?.title ?? "—"}</h1>
          <p className="mt-2 max-w-xs text-sm font-medium text-muted-foreground">{cat?.description ?? ""}</p>
        </div>
      </div>

      <div className="flex-1 px-5 pb-24">
        {catsQ.isError ? (
          <div className="mb-4">
            <QueryError compact onRetry={() => catsQ.refetch()} />
          </div>
        ) : null}

        <label className="mb-4 block text-xs font-bold text-muted-foreground">
          {t("search2.service", "Service")}
          {servicesQ.isLoading ? (
            <div className="mt-1.5 h-12 animate-pulse rounded-2xl bg-surface-2" />
          ) : servicesQ.isError ? (
            <div className="mt-2">
              <QueryError compact onRetry={() => servicesQ.refetch()} />
            </div>
          ) : (
          <select
            aria-label={t("search2.service", "Service")}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="focus-ring mt-1.5 h-12 w-full rounded-2xl bg-surface-2 px-4 text-sm font-bold text-foreground focus:outline-none"
          >
            {(servicesQ.data ?? []).map((service: any) => <option key={service.id} value={service.id}>{service.name_en}</option>)}
          </select>
          )}
        </label>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm font-extrabold tracking-tight text-foreground">
            {t("category.available", { count: sorted.length })}
            {cat && <> · <span className="text-brand">{t("category.fromPriceHr", { price: formatEGP(cat.fromPrice) })}</span></>}
          </div>
          <Link to="/search" className="focus-ring tap-scale inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-3.5 py-2 text-xs font-extrabold text-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t("category.filters")}
          </Link>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
          <Chip active={sort === "top"} onClick={() => setSort("top")}>{t("category.sortTop")}</Chip>
          <Chip active={sort === "price"} onClick={() => setSort("price")}>{t("category.sortPrice")}</Chip>
          <Chip active={sort === "experience"} onClick={() => setSort("experience")}>{t("category.sortExperience")}</Chip>
        </div>

        {provsQ.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-[1.75rem] bg-surface-2 animate-pulse" />)}
          </div>
        ) : provsQ.isError ? (
          <QueryError onRetry={() => provsQ.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="search"
            title={t("category.empty", "No pros available yet")}
            body={t("category.emptyBody", "We're onboarding more pros in your area. Check back soon.")}
          />
        ) : (
          <>
            <div className="space-y-3">
              {sorted.map((p) => <ProviderCard key={p.id} p={p} />)}
            </div>
            <div className="mt-3 text-center text-[11px] text-muted-foreground">{formatNumber(sorted.length)}</div>
          </>
        )}
      </div>
    </PhoneFrame>
  );
}
