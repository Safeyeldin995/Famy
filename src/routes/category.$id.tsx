import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, Chip, EmptyState } from "@/components/famio/ui";
import { CustomerPageHero } from "@/components/famio/CustomerPageHero";
import { CustomerFloatingPanel } from "@/components/famio/CustomerFloatingPanel";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { useCategories, useMarketplaceServices, useProviders } from "@/lib/db/queries";
import { toUICategory, toUIProvider } from "@/lib/db/adapters";
import { formatEGP } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/category/$id")({ component: CategoryPage });

export function CategoryPageContent({ categoryId }: { categoryId: string }) {
  const id = categoryId;
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
    const row = (catsQ.data ?? []).find((c: { slug: string }) => c.slug === id);
    return row ? toUICategory(row) : null;
  }, [catsQ.data, id]);

  const list = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data]);
  const sorted = [...list].sort((a, b) =>
    sort === "price"
      ? a.hourlyRate - b.hourlyRate
      : sort === "experience"
        ? b.yearsExp - a.yearsExp
        : b.rating - a.rating,
  );

  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHero
        title={cat?.title ?? "—"}
        subtitle={cat?.description ?? cat?.subtitle ?? ""}
        backTo="/home"
        right={
          <Link
            to="/search"
            className="focus-ring tap-scale inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-2 text-xs font-extrabold text-white backdrop-blur-sm"
          >
            <SlidersHorizontal
              className="h-3.5 w-3.5"
              strokeWidth={ICON_STROKE_BOLD}
              aria-hidden="true"
            />
            {t("category.filters")}
          </Link>
        }
      />

      <div className="px-5">
        <CustomerFloatingPanel>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-extrabold tracking-tight text-foreground">
              {t("category.available", { count: sorted.length })}
            </p>
            {cat ? (
              <p className="shrink-0 text-sm font-extrabold text-brand">
                {t("category.fromPriceHr", { price: formatEGP(cat.fromPrice) })}
              </p>
            ) : null}
          </div>

          {servicesQ.isLoading ? (
            <div className="mt-3 h-12 animate-pulse rounded-full bg-surface-2" />
          ) : servicesQ.isError ? (
            <div className="mt-3">
              <QueryError compact onRetry={() => servicesQ.refetch()} />
            </div>
          ) : (
            <select
              aria-label={t("search2.service")}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="focus-ring mt-3 h-12 w-full rounded-full bg-surface-2 px-4 text-sm font-bold text-foreground focus:outline-none"
            >
              {(servicesQ.data ?? []).map((service: { id: string; name_en: string }) => (
                <option key={service.id} value={service.id}>
                  {service.name_en}
                </option>
              ))}
            </select>
          )}
        </CustomerFloatingPanel>
      </div>

      <div className="flex-1 px-5 pb-24 pt-5">
        {catsQ.isError ? (
          <div className="mb-4">
            <QueryError compact onRetry={() => catsQ.refetch()} />
          </div>
        ) : null}

        <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
          <Chip active={sort === "top"} onClick={() => setSort("top")}>
            {t("category.sortTop")}
          </Chip>
          <Chip active={sort === "price"} onClick={() => setSort("price")}>
            {t("category.sortPrice")}
          </Chip>
          <Chip active={sort === "experience"} onClick={() => setSort("experience")}>
            {t("category.sortExperience")}
          </Chip>
        </div>

        {provsQ.isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
            ))}
          </div>
        ) : provsQ.isError ? (
          <QueryError onRetry={() => provsQ.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState icon="search" title={t("category.empty")} body={t("category.emptyBody")} />
        ) : (
          <div className="space-y-2.5">
            {sorted.map((p) => (
              <ProviderListRow
                key={p.id}
                to="/provider/$id"
                params={{ id: p.id }}
                avatar={p.avatar}
                name={p.name}
                subtitle={formatEGP(p.hourlyRate, { perHour: true })}
                meta={<ProviderRatingMeta rating={p.rating} reviews={p.reviews} />}
                pill={p.rating >= 4.9 ? { label: t("roles.topPro"), tone: "brand" } : undefined}
                trailing={
                  <span className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground">
                    {t("provider.bookNow")}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function CategoryPage() {
  const { id } = Route.useParams();
  return <CategoryPageContent categoryId={id} />;
}
