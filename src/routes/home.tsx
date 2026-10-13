import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, MapPin, Search } from "lucide-react";
import { AppShell } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderCard } from "@/components/famio/ProviderCard";
import { latinCustomerText } from "@/components/famio/customerProviders";
import { customerProviders } from "@/components/famio/customerProviders";
import { HomePromos } from "@/components/home/HomePromoStrip";
import { HomeRebookRow } from "@/components/home/HomeRebookRow";
import { useFeaturedPromoCodes } from "@/lib/db/promo-codes-queries";
import { rebookProvidersFromBookings } from "@/lib/home/rebookProviders";
import { useCategories, useProviders, useUnreadNotificationCount, useMyProfile, useDefaultAddress, useMyBookings } from "@/lib/db/queries";
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
  return <AppShell bg="bg-white">
    <header className="safe-top px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <Link to={previewPath("/addresses")} className="focus-ring flex min-h-11 min-w-0 items-center gap-2 text-pro-14 font-bold"><MapPin className="h-5 w-5 shrink-0" /><span className="truncate">{address.data?.area || t("customerHome.chooseArea")}</span></Link>
        <Link to={previewPath("/notifications")} aria-label={t("common.notifications")} className="focus-ring relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60"><Bell className="h-5 w-5" />{(unread.data ?? 0) > 0 && <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-brand" />}</Link>
      </div>
      <p className="mt-4 text-pro-14 text-muted-foreground">{t("greetings.withName", { greeting: t("greetings.hello"), name: profile.data?.full_name?.split(" ")[0] || t("greetings.there") })}</p>
      <h1 className="mt-1 text-pro-24 font-extrabold">{t("home.headline")}</h1>
      <Link to={previewPath("/search")} className="focus-ring mt-4 flex min-h-12 items-center gap-3 rounded-2xl border border-border/60 px-4 py-3 text-pro-14 text-muted-foreground"><Search className="h-5 w-5 shrink-0" />{t("home.searchHint")}</Link>
    </header>
    <div className="space-y-6 px-5 pb-6">
      <section>
        <h2 className="mb-3 text-pro-18 font-bold">{t("home.chooseService")}</h2>
        {categories.isError ? <QueryError compact onRetry={() => categories.refetch()} /> : <div className="grid grid-cols-2 gap-3">{(categories.data ?? []).filter((c) => ["babysitting", "tutoring"].includes(c.slug)).map((c) => <Link key={c.id} to={isPreviewRoute() ? "/preview/category/$id" : "/category/$id"} params={{ id: c.slug }} className="focus-ring flex min-h-16 items-center rounded-2xl border border-border/60 p-4 text-pro-14 font-bold">{i18n.language.startsWith("ar") ? c.name_ar : c.name_en}</Link>)}</div>}
      </section>
      {address.isLoading ? <div className="h-24 animate-pulse rounded-2xl bg-surface-2" /> : address.isError ? <QueryError onRetry={() => address.refetch()} /> : !address.data ? <section className="rounded-2xl border border-border/60 p-4">
        <h2 className="text-pro-16 font-bold">{t("customerHome.chooseArea")}</h2><p className="mt-2 text-pro-14 text-muted-foreground">{t("customerHome.addressHint")}</p><Link to={previewPath("/addresses/new")} className="focus-ring mt-3 inline-flex min-h-11 items-center text-pro-14 font-bold text-brand">{t("addresses.addAddress")}</Link>
      </section> : <NearbyProviders addressId={address.data.id} />}
    </div>
    <div className="[&_span]:text-pro-12 [&_button]:text-pro-12 [&_button]:min-h-11 [&_.text-overline]:text-pro-12">
    {promos.isError ? <QueryError compact onRetry={() => promos.refetch()} /> : <HomePromos offers={(promos.data ?? []).map((offer) => ({ ...offer, description_ar: latinCustomerText(offer.description_ar), description_en: latinCustomerText(offer.description_en) }))} />}
    <HomeRebookRow providers={rebookProvidersFromBookings(bookings.data ?? [])} loading={bookings.isLoading} error={bookings.isError} onRetry={() => bookings.refetch()} />
    </div>
  </AppShell>;
}

function NearbyProviders({ addressId }: { addressId: string }) {
  const { t } = useTranslation();
  const babysitters = useProviders({ addressId, categorySlug: "babysitting", limit: 20 });
  const teachers = useProviders({ addressId, categorySlug: "tutoring", limit: 20 });
  const providers = customerProviders([...(babysitters.data ?? []), ...(teachers.data ?? [])]);
  return <section>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-pro-18 font-bold">{t("customerHome.nearby")}</h2><Link to={previewPath("/search")} className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-bold text-brand">{t("common.seeAll")}</Link></div>
    <div className="space-y-3">{babysitters.isLoading || teachers.isLoading ? <div className="h-28 animate-pulse rounded-2xl bg-surface-2" /> : babysitters.isError || teachers.isError ? <QueryError onRetry={() => { void babysitters.refetch(); void teachers.refetch(); }} /> : providers.length ? providers.map((p) => <ProviderCard key={p.id} p={p} subtitle={providerPriceLabel(p, t)} />) : <div className="rounded-2xl border border-border/60 p-4"><p className="text-pro-14">{t("customerHome.empty")}</p><Link to={previewPath("/addresses")} className="focus-ring mt-2 inline-flex min-h-11 items-center text-pro-14 font-bold text-brand">{t("bookingUx.changeArea")}</Link></div>}</div>
  </section>;
}
