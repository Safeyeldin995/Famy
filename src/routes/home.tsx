import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell, Card, SectionHeader, EmptyState } from "@/components/famio/ui";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { ProviderTile, ProviderCard } from "@/components/famio/ProviderCard";
import { useCategories, useProviders, useNotifications, useMyProfile, useDefaultAddress } from "@/lib/db/queries";
import { toUICategory, toUIProvider } from "@/lib/db/adapters";
import { formatEGP } from "@/lib/utils";
import { Search, MapPin, Bell, ShieldCheck, Sparkles } from "lucide-react";

export const Route = createFileRoute("/home")({ component: Home });

const OFFERS = [
  { id: "o1", code: "FAMY20", gradient: "from-navy to-[#2d4ba8]", title: "20% off your first booking", subtitle: "Welcome to Famy" },
  { id: "o2", code: "WEEKEND15", gradient: "from-coral to-[#ff9a8b]", title: "Weekend cleans, weekday peace", subtitle: "Book Sat-Sun, save 15%" },
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
  const notifsQ = useNotifications();

  const cats = useMemo(() => (catsQ.data ?? []).map(toUICategory), [catsQ.data, i18n.language]);
  const providers = useMemo(() => (provsQ.data ?? []).map(toUIProvider), [provsQ.data, i18n.language]);

  const featured = providers.filter((p) => p.featured).slice(0, 6);
  const recent = providers.slice(0, 5);
  const unread = (notifsQ.data ?? []).some((n: any) => !n.read_at);

  return (
    <AppShell>
      <div className="safe-top px-5 pt-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-muted-foreground">{greeting},</p>
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{first} 👋</h1>
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-coral" />
              <span className="truncate">{addressQ.data?.area || t("common.location")}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageToggle variant="inline" />
            <Link
              to="/notifications"
              aria-label={t("common.notifications")}
              className="focus-ring relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface shadow-soft active:scale-95 transition-transform"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-coral" aria-hidden="true" />}
            </Link>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-3 rounded-2xl bg-navy/[0.04] px-3 py-2 text-[11px] font-semibold text-navy">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {t("home.trust1")}</span>
          <span className="h-1 w-1 rounded-full bg-navy/30" aria-hidden="true" />
          <span>{t("home.trust2")}</span>
          <span className="h-1 w-1 rounded-full bg-navy/30" aria-hidden="true" />
          <span>{t("home.trust3")}</span>
        </div>

        <Link
          to="/search"
          aria-label={t("common.search")}
          className="focus-ring mt-3 flex h-14 items-center gap-3 rounded-2xl bg-surface px-4 shadow-soft active:scale-[0.99] transition-transform"
        >
          <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-[15px] text-muted-foreground">{t("home.searchHint")}</span>
        </Link>
      </div>

      <div className="mt-5 overflow-x-auto no-scrollbar">
        <div className="flex gap-3 px-5">
          {OFFERS.map((o) => (
            <div key={o.id} className={`w-72 shrink-0 rounded-3xl bg-gradient-to-br ${o.gradient} p-5 text-white shadow-card`}>
              <Sparkles className="h-5 w-5 opacity-80" />
              <div className="mt-3 text-lg font-extrabold leading-tight">{t(`home.offers.${o.id}Title`, o.title)}</div>
              <div className="mt-1 text-sm text-white/80">{t(`home.offers.${o.id}Subtitle`, o.subtitle)}</div>
              <div className="mt-4 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold backdrop-blur" dir="ltr">{o.code}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <SectionHeader title={t("home.chooseService")} />
        <div className="grid grid-cols-2 gap-3 px-5">
          {cats.map((c) => (
            <Link
              key={c.id}
              to="/category/$id"
              params={{ id: c.id }}
              className="overflow-hidden rounded-3xl bg-surface p-4 shadow-soft active:scale-[0.98] transition-transform"
            >
              <div className="grid h-14 w-14 place-items-center rounded-2xl text-2xl" style={{ background: c.tint }}>
                {c.icon}
              </div>
              <div className="mt-3 text-sm font-extrabold">{c.title}</div>
              <div className="text-[11px] text-muted-foreground">{c.description.slice(0, 48)}</div>
              <div className="mt-2 text-[11px] font-semibold text-navy">{t("common.from")} {formatEGP(c.fromPrice, { perHour: true })}</div>
            </Link>
          ))}
          {catsQ.isLoading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 rounded-3xl bg-surface animate-pulse" />
          ))}
        </div>
        {catsQ.isError && (
          <div className="mt-3">
            <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          </div>
        )}
      </div>

      {featured.length > 0 && (
        <div className="mt-6">
          <SectionHeader title={t("home.featured")} />
          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-3 px-5 pb-1">
              {featured.map((p) => <ProviderTile key={p.id} p={p} />)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <SectionHeader title={t("home.recent")} />
        <div className="space-y-3 px-5">
          {provsQ.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-3xl bg-surface animate-pulse" />
            ))
          ) : provsQ.isError ? (
            <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : recent.length === 0 ? (
            <EmptyState emoji="🧑‍🔧" title={t("home.recentEmpty")} body={t("home.recentEmptyBody")} />
          ) : (
            recent.map((p) => <ProviderCard key={p.id} p={p} />)
          )}
        </div>
      </div>

      <div className="mt-6 px-5">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-navy/10">
              <ShieldCheck className="h-6 w-6 text-navy" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold">{t("home.whyTrust")}</div>
              <div className="text-xs text-muted-foreground">{t("home.whyTrustBody")}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { n: "12k+", l: t("home.statFamilies") },
              { n: "98%", l: t("home.statJobs") },
              { n: "24/7", l: t("home.statSupport") },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl bg-surface-2 py-3">
                <div className="text-sm font-extrabold text-navy">{s.n}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="h-6" />
    </AppShell>
  );
}
