import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneFrame, TopBar, Chip, EmptyState } from "@/components/famio/ui";
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
    <PhoneFrame>
      <div className="relative">
        <div className="h-44 w-full" style={{ background: `linear-gradient(135deg, var(--navy), oklch(0.42 0.16 268))` }}>
          <TopBar back={{ to: "/home" }} right={<button aria-label={t("category.filters")} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur"><Filter className="h-4 w-4" /></button>} transparent />
          <div className="px-5 pb-4 text-white">
            <div className="text-xs font-semibold opacity-80">{cat?.subtitle ?? ""}</div>
            <div className="text-2xl font-extrabold">{cat?.title ?? "—"}</div>
            <div className="mt-1 max-w-xs text-xs text-white/80">{cat?.description ?? ""}</div>
          </div>
        </div>
      </div>

      <div className="-mt-4 flex-1 rounded-t-3xl bg-surface-2 px-5 pt-5 pb-24">
        <label className="mb-4 block text-[11px] font-bold text-muted-foreground">
          {t("search2.service", "Service")}
          <select
            aria-label={t("search2.service", "Service")}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
          >
            {(servicesQ.data ?? []).map((service: any) => <option key={service.id} value={service.id}>{service.name_en}</option>)}
          </select>
        </label>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold">
            {t("category.available", { count: sorted.length })}
            {cat && <> · {t("category.fromPriceHr", { price: formatEGP(cat.fromPrice) })}</>}
          </div>
          <Link to="/search" className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-bold shadow-soft">
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
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-3xl bg-surface animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            emoji="🔎"
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
