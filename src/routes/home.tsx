import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell, Avatar } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
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
import { MapPin, Search, Bell, Star } from "lucide-react";
import { ICON_STROKE, ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/home")({ component: Home });

function Home() {
  const profileQ = useMyProfile();
  const addressQ = useDefaultAddress();
  const { t, i18n } = useTranslation();

  const [greeting, setGreeting] = useState(t("greetings.hello"));
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? t("greetings.morning") : h < 18 ? t("greetings.afternoon") : t("greetings.evening"));
  }, [t, i18n.language]);
  const first = profileQ.data?.full_name?.split(" ")[0] || t("greetings.there");

  const catsQ = useCategories();
  const provsQ = useProviders({ limit: 20 });
  const unreadQ = useUnreadNotificationCount();
  const bookingsQ = useMyBookings();
  const featuredPromosQ = useFeaturedPromoCodes();

  const cats = useMemo(() => (catsQ.data ?? []).map(toUICategory), [catsQ.data, i18n.language]);
  const providers = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data, i18n.language]);

  const featured = providers.filter((p) => p.featured).slice(0, 6);
  const rebookProviders = useMemo(
    () => rebookProvidersFromBookings(bookingsQ.data ?? []),
    [bookingsQ.data, i18n.language],
  );
  const unread = (unreadQ.data ?? 0) > 0;

  return (
    <AppShell bg="bg-background" hideNav={false}>
      {/* Modern minimal header */}
      <header className="safe-top px-5 pb-6 pt-5">
        <div className="flex items-center justify-between">
          <Link
            to="/addresses"
            className="focus-ring tap-scale inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-bold text-foreground"
          >
            <MapPin className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_BOLD} />
            <span className="max-w-[12rem] truncate">
              {addressQ.isError ? t("common.location") : addressQ.data?.area || t("common.location")}
            </span>
          </Link>
          <Link
            to="/notifications"
            className="focus-ring tap-scale relative grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-foreground"
          >
            <Bell className="h-4 w-4" strokeWidth={ICON_STROKE} />
            {!unreadQ.isError && unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-background" />}
          </Link>
        </div>

        <div className="mt-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground leading-[1.1]">
            <span className="block text-muted-foreground font-medium text-xl mb-1">{greeting},</span>
            {first}.
          </h1>
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

        <Link
          to="/search"
          className="focus-ring tap-scale mt-8 flex h-14 items-center gap-3 rounded-full bg-surface-2 px-5 text-muted-foreground transition-all hover:bg-surface-elevated hover:shadow-sm"
        >
          <Search className="h-5 w-5 shrink-0" strokeWidth={ICON_STROKE} />
          <span className="flex-1 text-base font-medium">{t("home.searchHint")}</span>
        </Link>
      </header>

      {/* Grid of categories using photo-driven look or ultra-minimal icons */}
      <HomeCategoryGrid
        categories={cats}
        loading={catsQ.isLoading}
        error={catsQ.isError}
        onRetry={() => catsQ.refetch()}
      />

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

      {/* Horizontal scrolling featured pros (large portrait cards) */}
      <section className="mt-10 px-0 pb-8">
        <div className="mb-4 flex items-center justify-between px-5">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground">{t("home.featured")}</h2>
        </div>
        <div className="flex gap-4 overflow-x-auto px-5 pb-4 no-scrollbar">
          {provsQ.isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-64 w-48 shrink-0 animate-pulse rounded-[2rem] bg-surface-2" />
            ))
          ) : provsQ.isError ? (
            <div className="w-full py-4">
              <QueryError compact onRetry={() => provsQ.refetch()} />
            </div>
          ) : (
          featured.map((p) => (
            <Link
              key={p.id}
              to="/provider/$id"
              params={{ id: p.id }}
              className="focus-ring tap-scale group relative block h-64 w-48 shrink-0 overflow-hidden rounded-[2rem] bg-surface-2 shadow-sm"
            >
              <img src={p.avatar || undefined} alt={p.name} className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent transition-opacity group-hover:opacity-90" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="text-sm font-extrabold line-clamp-1">{p.name}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-white/80">
                  <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-warning text-warning" />{p.rating}</span>
                  <span>{formatEGP(p.hourlyRate, { perHour: true })}</span>
                </div>
              </div>
            </Link>
          ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
