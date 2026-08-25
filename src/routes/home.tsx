import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell, EmptyState } from "@/components/famio/ui";
import { ProviderTile, ProviderCard } from "@/components/famio/ProviderCard";
import { HomeHero } from "@/components/home/HomeHero";
import { HomePromos } from "@/components/home/HomePromos";
import { HomeCategories } from "@/components/home/HomeCategories";
import { HomeSection } from "@/components/home/HomeSection";
import { HomeTrustBanner } from "@/components/home/HomeTrustBanner";
import {
  useCategories,
  useProviders,
  useUnreadNotificationCount,
  useMyProfile,
  useDefaultAddress,
  useMyBookings,
} from "@/lib/db/queries";
import { toUICategory, toUIProvider } from "@/lib/db/adapters";

export const Route = createFileRoute("/home")({ component: Home });

const OFFERS = [
  {
    id: "o1",
    code: "FAMY20",
    gradient: "from-navy to-[#2a4490]",
    title: "20% off your first booking",
    subtitle: "Welcome to Famy",
  },
  {
    id: "o2",
    code: "WEEKEND15",
    gradient: "from-coral to-[#ff9588]",
    title: "Weekend cleans, weekday peace",
    subtitle: "Book Sat-Sun, save 15%",
  },
];

function Home() {
  const profileQ = useMyProfile();
  const addressQ = useDefaultAddress();
  const { t, i18n } = useTranslation();

  const [greeting, setGreeting] = useState(t("greetings.hello"));
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? t("greetings.morning") : h < 18 ? t("greetings.afternoon") : t("greetings.evening"));
  }, [t]);
  const first = profileQ.data?.full_name?.split(" ")[0] || t("greetings.there");

  const catsQ = useCategories();
  const provsQ = useProviders({ limit: 20 });
  const unreadQ = useUnreadNotificationCount();
  const bookingsQ = useMyBookings();

  const cats = useMemo(() => (catsQ.data ?? []).map(toUICategory), [catsQ.data, i18n.language]);
  const providers = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data, i18n.language]);

  const featured = providers.filter((p) => p.featured).slice(0, 6);
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const list: ReturnType<typeof toUIProvider>[] = [];
    for (const b of bookingsQ.data ?? []) {
      const p = (b as any).provider;
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      list.push(toUIProvider(p));
      if (list.length >= 5) break;
    }
    return list;
  }, [bookingsQ.data, i18n.language]);
  const unread = (unreadQ.data ?? 0) > 0;

  return (
    <AppShell bg="bg-background">
      <HomeHero
        greeting={greeting}
        firstName={first}
        location={addressQ.data?.area || t("common.location")}
        unread={unread}
        searchHint={t("home.searchHint")}
        trustLabels={[t("home.trust1"), t("home.trust2"), t("home.trust3")]}
      />

      <HomePromos offers={OFFERS} />

      <HomeCategories categories={cats} loading={catsQ.isLoading} error={catsQ.isError} />

      {featured.length > 0 ? (
        <HomeSection title={t("home.featured")} subtitle={t("home.featuredSubtitle", "Top rated")}>
          <div className="overflow-x-auto no-scrollbar snap-x snap-mandatory">
            <div className="flex gap-3 px-5 pb-1">
              {featured.map((provider) => (
                <div key={provider.id} className="snap-start">
                  <ProviderTile p={provider} />
                </div>
              ))}
            </div>
          </div>
        </HomeSection>
      ) : null}

      <HomeSection title={t("home.recent")} subtitle={t("home.recentSubtitle", "Your history")}>
        <div className="space-y-3 px-5">
          {bookingsQ.isLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="surface-card h-24 animate-pulse bg-surface-2" />
            ))
          ) : bookingsQ.isError ? (
            <EmptyState
              emoji="⚠️"
              title={t("common.errorTitle", "Something went wrong")}
              body={t("common.tryAgain", "Please try again.")}
            />
          ) : recent.length === 0 ? (
            <EmptyState emoji="🧑‍🔧" title={t("home.recentEmpty")} body={t("home.recentEmptyBody")} />
          ) : (
            recent.map((provider) => <ProviderCard key={provider.id} p={provider} />)
          )}
        </div>
      </HomeSection>

      <div className="mt-8">
        <HomeTrustBanner />
      </div>
      <div className="h-6" />
    </AppShell>
  );
}
