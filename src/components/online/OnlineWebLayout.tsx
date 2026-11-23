import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Video } from "lucide-react";
import wordmark from "@/assets/famy-wordmark.png";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

const TABS = [
  { to: ONLINE_WEB_ROUTE_IDS.tutors, key: "onlineWeb.nav.tutors" },
  { to: ONLINE_WEB_ROUTE_IDS.lessons, key: "onlineWeb.nav.lessons" },
  { to: ONLINE_WEB_ROUTE_IDS.wallet, key: "onlineWeb.nav.wallet" },
  { to: ONLINE_WEB_ROUTE_IDS.providerLessons, key: "onlineWeb.nav.providerLessons" },
] as const;

export function OnlineWebLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh bg-surface-2 text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-5">
          <Link
            to={ONLINE_WEB_ROUTE_IDS.home}
            className="focus-ring flex items-center gap-2 shrink-0"
            aria-label={t("onlineWeb.title")}
          >
            <img
              src={wordmark}
              alt=""
              width={1092}
              height={375}
              className="h-7 w-auto max-w-[5.5rem] object-contain"
            />
            <span className="hidden items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-pro-12 font-bold text-brand sm:inline-flex">
              <Video className="h-3.5 w-3.5" aria-hidden />
              {t("onlineWeb.badge")}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="focus-ring hidden text-pro-13 font-semibold text-muted-foreground hover:text-foreground sm:inline"
            >
              {t("site.nav.home")}
            </Link>
            <LanguageToggle variant="inline" />
          </div>
        </div>
        <nav
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-5 pb-3"
          aria-label={t("onlineWeb.nav.label")}
        >
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={`focus-ring whitespace-nowrap rounded-full px-4 py-2 text-pro-13 font-bold transition-colors ${
                path === tab.to || path.startsWith(`${tab.to}/`)
                  ? "bg-navy text-navy-foreground"
                  : "bg-white text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(tab.key)}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}