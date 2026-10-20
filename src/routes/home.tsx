import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Baby, Bell, ChevronDown, GraduationCap, MapPin, Search } from "lucide-react";
import { AppShell } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { latinCustomerText } from "@/components/famio/customerProviders";
import { customerProviders } from "@/components/famio/customerProviders";
import { HomePromos } from "@/components/home/HomePromoStrip";
import { HomeRebookRow } from "@/components/home/HomeRebookRow";
import { HomeTrustLine } from "@/components/home/HomeTrustLine";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { useFeaturedPromoCodes } from "@/lib/db/promo-codes-queries";
import { rebookProvidersFromBookings } from "@/lib/home/rebookProviders";
import {
  useCategories,
  useProviders,
  useUnreadNotificationCount,
  useMyProfile,
  useDefaultAddress,
  useMyBookings,
} from "@/lib/db/queries";
import { providerPriceLabel } from "@/lib/db/adapters";
import { previewPath } from "@/lib/preview/previewPath";
import { isPreviewRoute } from "@/lib/preview/constants";
import { useProviderOnlyCustomerRedirect } from "@/lib/auth/providerOnlyCustomerGuard";

export const Route = createFileRoute("/home")({ component: Home });

function Home() {
  const { blocking } = useProviderOnlyCustomerRedirect();
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const categories = useCategories();
  const unread = useUnreadNotificationCount();
  const bookings = useMyBookings();
  const promos = useFeaturedPromoCodes();
  if (blocking) return null;
  const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  const firstName = profile.data?.full_name?.split(" ")[0] || t("greetings.there");
  return (
    <AppShell bg="bg-white">
      <header className="relative overflow-hidden rounded-b-[2rem] bg-gradient-to-b from-brand/[0.12] via-brand/[0.05] to-white px-5 pb-6">
        <div className="safe-top flex items-center justify-between gap-3 pt-4">
          <Link
            to={previewPath("/addresses")}
            className="focus-ring flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-white px-3.5 py-2 text-pro-13 font-bold shadow-sm"
          >
            <MapPin className="h-4 w-4 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} />
            <span className="truncate">{address.data?.area || t("customerHome.chooseArea")}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link
            to={previewPath("/notifications")}
            aria-label={t("common.notifications")}
            className="focus-ring relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white shadow-sm"
          >
            <Bell className="h-5 w-5" />
            {(unread.data ?? 0) > 0 && (
              <span className="absolute end-2.5 top-2.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
            )}
          </Link>
        </div>
        <p className="mt-6 text-pro-14 font-semibold text-muted-foreground">
          {t("greetings.withName", { greeting: t("greetings.hello"), name: firstName })}
        </p>
        <h1 className="mt-1 text-[1.625rem] font-extrabold leading-tight text-balance">
          {t("home.headline")}
        </h1>
        <Link
          to={previewPath("/search")}
          className="focus-ring mt-5 flex min-h-14 items-center gap-3 rounded-2xl bg-white px-4 text-pro-14 font-medium text-muted-foreground shadow-soft"
        >
          <Search className="h-5 w-5 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} />
          <span className="truncate">{t("customerSearch.placeholder")}</span>
        </Link>
      </header>

      <div className="space-y-8 px-5 pt-6 pb-2">
        <section>
          <h2 className="mb-3 text-pro-18 font-extrabold">{t("home.chooseService")}</h2>
          {categories.isError ? (
            <QueryError compact onRetry={() => categories.refetch()} />
          ) : categories.isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />
              <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {(categories.data ?? [])
                .filter((c) => c.slug in SERVICE_TILES)
                .map((c) => {
                  const tile = SERVICE_TILES[c.slug as keyof typeof SERVICE_TILES];
                  const Icon = tile.icon;
                  return (
                    <Link
                      key={c.id}
                      to={isPreviewRoute() ? "/preview/category/$id" : "/category/$id"}
                      params={{ id: c.slug }}
                      className={`focus-ring tap-scale relative flex min-h-40 flex-col justify-between overflow-hidden rounded-3xl p-4 ${tile.surface}`}
                    >
                      <span
                        className={`grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm ${tile.ink}`}
                      >
                        <Icon
                          className="h-6 w-6"
                          strokeWidth={ICON_STROKE_BOLD}
                          aria-hidden="true"
                        />
                      </span>
                      <span>
                        <span className="block text-pro-16 font-extrabold text-foreground">
                          {lang === "ar" ? c.name_ar : c.name_en}
                        </span>
                        <span className="mt-1 block text-pro-12 font-semibold leading-snug text-foreground/60">
                          {t(tile.taglineKey)}
                        </span>
                      </span>
                      <ArrowUpRight
                        className={`absolute end-3 top-3 h-5 w-5 rtl:-scale-x-100 ${tile.ink}`}
                        aria-hidden="true"
                      />
                    </Link>
                  );
                })}
            </div>
          )}
        </section>

        {promos.isError ? (
          <QueryError compact onRetry={() => promos.refetch()} />
        ) : (
          <HomePromos
            offers={(promos.data ?? []).map((offer) => ({
              ...offer,
              description_ar: latinCustomerText(offer.description_ar),
              description_en: latinCustomerText(offer.description_en),
            }))}
          />
        )}

        {address.isLoading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
        ) : address.isError ? (
          <QueryError onRetry={() => address.refetch()} />
        ) : !address.data ? (
          <section className="flex items-start gap-3 rounded-3xl bg-surface-2 p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-brand">
              <MapPin className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-pro-16 font-extrabold">{t("customerHome.chooseArea")}</h2>
              <p className="mt-1 text-pro-13 leading-relaxed text-muted-foreground">
                {t("customerHome.addressHint")}
              </p>
              <Link
                to={previewPath("/addresses/new")}
                className="focus-ring mt-1 inline-flex min-h-11 items-center text-pro-14 font-extrabold text-brand"
              >
                {t("addresses.addAddress")}
              </Link>
            </div>
          </section>
        ) : (
          <NearbyProviders addressId={address.data.id} />
        )}
      </div>

      <HomeRebookRow
        providers={rebookProvidersFromBookings(bookings.data ?? [])}
        loading={bookings.isLoading}
        error={bookings.isError}
        onRetry={() => bookings.refetch()}
      />
      <HomeTrustLine />
    </AppShell>
  );
}

const SERVICE_TILES = {
  babysitting: {
    icon: Baby,
    surface: "bg-brand/[0.08]",
    ink: "text-brand",
    taglineKey: "home.babysittingTag",
  },
  tutoring: {
    icon: GraduationCap,
    surface: "bg-lavender/[0.14]",
    ink: "text-lavender",
    taglineKey: "home.tutoringTag",
  },
} as const;

function NearbyProviders({ addressId }: { addressId: string }) {
  const { t } = useTranslation();
  const babysitters = useProviders({ addressId, categorySlug: "babysitting", limit: 20 });
  const teachers = useProviders({ addressId, categorySlug: "tutoring", limit: 20 });
  const providers = customerProviders([...(babysitters.data ?? []), ...(teachers.data ?? [])]);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-pro-18 font-extrabold">{t("customerHome.nearby")}</h2>
        <Link
          to={previewPath("/search")}
          className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-bold text-brand"
        >
          {t("common.seeAll")}
        </Link>
      </div>
      <div className="space-y-3">
        {babysitters.isLoading || teachers.isLoading ? (
          <div className="h-28 animate-pulse rounded-2xl bg-surface-2" />
        ) : babysitters.isError || teachers.isError ? (
          <QueryError
            onRetry={() => {
              void babysitters.refetch();
              void teachers.refetch();
            }}
          />
        ) : providers.length ? (
          providers.map((p) => (
            <ProviderCard key={p.id} p={p} subtitle={providerPriceLabel(p, t)} />
          ))
        ) : (
          <div className="rounded-2xl border border-border/60 p-4">
            <p className="text-pro-14">{t("customerHome.empty")}</p>
            <Link
              to={previewPath("/addresses")}
              className="focus-ring mt-2 inline-flex min-h-11 items-center text-pro-14 font-bold text-brand"
            >
              {t("bookingUx.changeArea")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
