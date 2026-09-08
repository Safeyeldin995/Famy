import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderListRow, ProviderRatingMeta } from "@/components/famio/ProviderListRow";
import { HomeCategoryGrid } from "@/components/home/HomeCategoryGrid";
import { HomePromos } from "@/components/home/HomePromoStrip";
import { HomeRebookRow } from "@/components/home/HomeRebookRow";
import {
  useCategories,
  useProviders,
  useUnreadNotificationCount,
  useMyProfile,
  useDefaultAddress,
  useMyBookings,
} from "@/lib/db/queries";
import { useFeaturedPromoCodes } from "@/lib/db/promo-codes-queries";
import { rebookProvidersFromBookings } from "@/lib/home/rebookProviders";
import { toUICategory, toUIProvider } from "@/lib/db/adapters";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  Headphones,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP } from "@/lib/utils";
import { previewPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/home")({ component: Home });

function SectionHeader({ overline, title }: { overline: string; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-end justify-between gap-3 px-5">
      <div className="min-w-0">
        <p className="text-overline">{overline}</p>
        <h2 className="text-title mt-1 text-foreground">{title}</h2>
      </div>
      <Link to={previewPath("/search")} className="focus-ring shrink-0 text-xs font-extrabold text-brand">
        {t("common.seeAll")}
      </Link>
    </div>
  );
}

function Home() {
  const profileQ = useMyProfile();
  const addressQ = useDefaultAddress();
  const { t, i18n } = useTranslation();

  const [greeting, setGreeting] = useState(t("greetings.hello"));
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(
      h < 12 ? t("greetings.morning") : h < 18 ? t("greetings.afternoon") : t("greetings.evening"),
    );
  }, [t, i18n.language]);
  const first = profileQ.data?.full_name?.split(" ")[0] || t("greetings.there");

  const catsQ = useCategories();
  const provsQ = useProviders({ limit: 20 });
  const unreadQ = useUnreadNotificationCount();
  const bookingsQ = useMyBookings();
  const featuredPromosQ = useFeaturedPromoCodes();

  const cats = useMemo(() => (catsQ.data ?? []).map(toUICategory), [catsQ.data, i18n.language]);
  const providers = useMemo(
    () => (provsQ.data ?? []).map(toUIProvider),
    [provsQ.data, i18n.language],
  );

  const featured = providers.filter((p) => p.featured).slice(0, 4);
  const rebookProviders = useMemo(
    () => rebookProvidersFromBookings(bookingsQ.data ?? []),
    [bookingsQ.data, i18n.language],
  );
  const unread = (unreadQ.data ?? 0) > 0;

  const trust = [
    { icon: ShieldCheck, label: t("home.trust1") },
    { icon: Sparkles, label: t("home.trust2") },
    { icon: Headphones, label: t("home.trust3") },
  ] as const;

  return (
    <AppShell bg="bg-background" hideNav={false}>
      <header className="brand-hero safe-top relative overflow-hidden rounded-b-[2.5rem] px-5 pb-16 pt-3">
        <span
          className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -start-14 bottom-0 h-40 w-40 rounded-full bg-white/10 blur-2xl"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center justify-between gap-3">
          <Link
            to={previewPath("/addresses")}
            className="focus-ring tap-scale inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3.5 py-2 text-xs font-extrabold text-white backdrop-blur-sm"
          >
            <MapPin
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={ICON_STROKE_BOLD}
              aria-hidden="true"
            />
            <span className="max-w-[11rem] truncate">
              {addressQ.isError
                ? t("common.location")
                : addressQ.data?.area || t("common.location")}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 opacity-80"
              strokeWidth={ICON_STROKE_BOLD}
              aria-hidden="true"
            />
          </Link>
          <Link
            to={previewPath("/notifications")}
            aria-label={t("common.notifications")}
            className="focus-ring tap-scale relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur-sm"
          >
            <Bell className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden="true" />
            {!unreadQ.isError && unread && (
              <span className="absolute end-2.5 top-2.5 h-2 w-2 rounded-full bg-white ring-2 ring-brand" />
            )}
          </Link>
        </div>

        <div className="relative z-10 mt-7">
          <p className="text-sm font-bold text-white/75">
            {t("greetings.withName", { greeting, name: first })}
          </p>
          <h1 className="mt-2 text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-white">
            {t("home.headline")}
          </h1>
        </div>
      </header>

      <div className="px-5">
        <Link
          to={previewPath("/search")}
          className="focus-ring tap-scale relative z-10 -mt-10 flex items-center gap-3 rounded-[1.5rem] border border-border/40 bg-surface p-3 shadow-float"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[1.125rem] bg-brand text-brand-foreground">
            <Search className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.95rem] font-extrabold text-foreground">
              {t("home.searchHint")}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-semibold text-muted-foreground">
              {t("home.exploreServices")}
            </span>
          </span>
          <ArrowRight
            className="me-2 h-4 w-4 shrink-0 rtl-flip text-muted-foreground"
            strokeWidth={ICON_STROKE_BOLD}
            aria-hidden="true"
          />
        </Link>

        <div className="mt-4 flex items-center justify-between gap-2">
          {trust.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-muted-foreground"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 text-brand"
                strokeWidth={ICON_STROKE_BOLD}
                aria-hidden="true"
              />
              <span className="truncate">{label}</span>
            </span>
          ))}
        </div>

        {profileQ.isError && (
          <div className="mt-4">
            <QueryError compact onRetry={() => profileQ.refetch()} />
          </div>
        )}
        {addressQ.isError && (
          <div className="mt-4">
            <QueryError compact onRetry={() => addressQ.refetch()} />
          </div>
        )}
        {unreadQ.isError && (
          <div className="mt-4">
            <QueryError compact onRetry={() => unreadQ.refetch()} />
          </div>
        )}
      </div>

      <div className="mt-8">
        <SectionHeader overline={t("home.servicesSubtitle")} title={t("home.chooseService")} />
        <HomeCategoryGrid
          categories={cats}
          loading={catsQ.isLoading}
          error={catsQ.isError}
          onRetry={() => catsQ.refetch()}
        />
      </div>

      {featuredPromosQ.isLoading ? null : featuredPromosQ.isError ? (
        <div className="mt-8 px-5">
          <QueryError compact onRetry={() => featuredPromosQ.refetch()} />
        </div>
      ) : (
        <HomePromos offers={featuredPromosQ.data ?? []} />
      )}

      <HomeRebookRow
        providers={rebookProviders}
        loading={bookingsQ.isLoading}
        error={bookingsQ.isError}
        onRetry={() => bookingsQ.refetch()}
      />

      {provsQ.isLoading || provsQ.isError || featured.length > 0 ? (
        <section className="mt-9 pb-6">
          <SectionHeader overline={t("home.featuredSubtitle")} title={t("home.featured")} />
          <div className="space-y-2.5 px-5">
            {provsQ.isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-24 animate-pulse rounded-[2rem] bg-surface-2" />
              ))
            ) : provsQ.isError ? (
              <QueryError compact onRetry={() => provsQ.refetch()} />
            ) : (
              featured.map((p) => (
                <ProviderListRow
                  key={p.id}
                  to="/provider/$id"
                  params={{ id: p.id }}
                  avatar={p.avatar}
                  name={p.name}
                  subtitle={formatEGP(p.hourlyRate, { perHour: true })}
                  meta={<ProviderRatingMeta rating={p.rating} reviews={p.reviews} />}
                  trailing={
                    <span className="shrink-0 rounded-full bg-brand px-3.5 py-2 text-[11px] font-extrabold text-brand-foreground">
                      {t("provider.bookNow")}
                    </span>
                  }
                />
              ))
            )}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
