import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/famio/ui";
import { HomeCategoryGrid } from "@/components/home/HomeCategoryGrid";
import { HomeFeaturedCarousel } from "@/components/home/HomeFeaturedCarousel";
import { HomeHeroPanel } from "@/components/home/HomeHeroPanel";
import { HomePromoStrip } from "@/components/home/HomePromoStrip";
import { HomeRebookRow } from "@/components/home/HomeRebookRow";
import { HomeTrustLine } from "@/components/home/HomeTrustLine";
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

const PROMO = {
  id: "o1",
  code: "FAMY20",
};

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
    <AppShell bg="bg-background" hideNav={false}>
      <HomeHeroPanel
        greeting={greeting}
        firstName={first}
        location={addressQ.data?.area || t("common.location")}
        unread={unread}
        searchHint={t("home.searchHint")}
        headline={t("home.headline")}
      />

      <div className="-mt-6 rounded-t-[2rem] bg-background pb-4">
        <HomeCategoryGrid categories={cats} loading={catsQ.isLoading} />
        <HomeFeaturedCarousel providers={featured} />
        <HomeRebookRow providers={recent} loading={bookingsQ.isLoading} error={bookingsQ.isError} />
        <HomePromoStrip offer={PROMO} />
        <HomeTrustLine />
      </div>
      <div className="h-4" />
    </AppShell>
  );
}
