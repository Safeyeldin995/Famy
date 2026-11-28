import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Baby, Bell, ChevronDown, GraduationCap, MapPin } from "lucide-react";
import { AppShell } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { latinCustomerText } from "@/components/famio/customerProviders";
import { HomePromos } from "@/components/home/HomePromoStrip";
import { HomeActiveBookingCard } from "@/components/home/HomeActiveBookingCard";
import { HomeRebookRow } from "@/components/home/HomeRebookRow";
import { HomeTrustLine } from "@/components/home/HomeTrustLine";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { useFeaturedPromoCodes } from "@/lib/db/promo-codes-queries";
import { rebookProvidersFromBookings } from "@/lib/home/rebookProviders";
import {
  useCategories,
  useUnreadNotificationCount,
  useMyProfile,
  useDefaultAddress,
  useMyBookings,
} from "@/lib/db/queries";
import {
  homeCategoryLessonSlug,
  visibleHomeDoors,
  type HomeDoorId,
} from "@/lib/catalog/homeCategories";
import { LessonIllustration } from "@/components/lessons/LessonIllustration";
import { previewPath } from "@/lib/preview/previewPath";
import { isPreviewRoute } from "@/lib/preview/constants";
import { useProviderOnlyCustomerRedirect } from "@/lib/auth/providerOnlyCustomerGuard";

export const Route = createFileRoute("/home")({ component: Home });

function Home() {
  const { blocking } = useProviderOnlyCustomerRedirect();
  const { t } = useTranslation();
  const profile = useMyProfile();
  const address = useDefaultAddress();
  const categories = useCategories();
  const unread = useUnreadNotificationCount();
  const bookings = useMyBookings();
  const promos = useFeaturedPromoCodes();
  if (blocking) return null;
  const firstName = profile.data?.full_name?.split(" ")[0] || t("greetings.there");
  const doors = visibleHomeDoors((categories.data ?? []).map((c) => c.slug));
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
      </header>

      {bookings.data ? <HomeActiveBookingCard bookings={bookings.data} /> : null}

      <div className="space-y-8 px-5 pt-6 pb-2">
        <section aria-label={t("home.headline")}>
          {categories.isError ? (
            <QueryError compact onRetry={() => categories.refetch()} />
          ) : categories.isLoading ? (
            <div className="grid grid-cols-2 gap-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-3xl bg-surface-2" />
              ))}
            </div>
          ) : !doors.length ? (
            <p className="rounded-2xl border border-border/60 p-4 text-pro-14">
              {t("home.doors.empty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {doors.map((id) => {
                const door = DOORS[id];
                const Icon = door.icon;
                const lesson = homeCategoryLessonSlug(id);
                return (
                  <Link
                    key={id}
                    data-testid={`home-door-${id}`}
                    to={isPreviewRoute() ? "/preview/category/$id" : "/category/$id"}
                    params={{ id }}
                    className={`focus-ring tap-scale relative flex min-h-40 flex-col justify-between gap-3 overflow-hidden rounded-3xl p-4 ${door.surface}`}
                  >
                    <span
                      className={`grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ${door.ink}`}
                    >
                      {lesson ? (
                        <LessonIllustration serviceSlug={lesson} className="h-11 w-11" />
                      ) : Icon ? (
                        <Icon className="h-6 w-6" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
                      ) : null}
                    </span>
                    <span>
                      <span className="block text-pro-18 font-extrabold text-foreground">
                        {t(door.titleKey)}
                      </span>
                      <span className="mt-1 block text-pro-12 font-semibold leading-snug text-foreground/60">
                        {t(door.bodyKey)}
                      </span>
                    </span>
                    <ArrowUpRight
                      className={`absolute end-3 top-3 h-5 w-5 rtl:-scale-x-100 ${door.ink}`}
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
        ) : null}
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

const DOORS: Record<
  HomeDoorId,
  { surface: string; ink: string; titleKey: string; bodyKey: string; icon?: typeof Baby }
> = {
  tutoring: {
    icon: GraduationCap,
    surface: "bg-lavender/[0.14]",
    ink: "text-lavender",
    titleKey: "home.doors.tutorTitle",
    bodyKey: "home.doors.tutorBody",
  },
  quran: {
    surface: "bg-brand/[0.08]",
    ink: "text-brand",
    titleKey: "home.doors.quranTitle",
    bodyKey: "home.doors.quranBody",
  },
  music: {
    surface: "bg-lavender/[0.14]",
    ink: "text-lavender",
    titleKey: "home.doors.musicTitle",
    bodyKey: "home.doors.musicBody",
  },
  babysitting: {
    icon: Baby,
    surface: "bg-brand/[0.08]",
    ink: "text-brand",
    titleKey: "home.doors.babysitterTitle",
    bodyKey: "home.doors.babysitterBody",
  },
};
