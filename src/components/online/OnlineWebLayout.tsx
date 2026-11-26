import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Menu, Video, X } from "lucide-react";
import wordmark from "@/assets/famy-wordmark.png";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { useOnlineWebNavTabs } from "@/lib/web/useOnlineWebNavTabs";
import { useOnlineWebSessionGate } from "@/lib/web/useOnlineWebSessionGate";
import { OnlineWebAccountMenu } from "@/components/online/OnlineWebAccountMenu";
import { OnlineWebNotificationsBell } from "@/components/online/OnlineWebNotificationsBell";
import { OnlineWebFooter } from "@/components/online/OnlineWebFooter";

function isTabActive(path: string, to: string): boolean {
  if (to === ONLINE_WEB_ROUTE_IDS.home) return path === to || path === `${to}/`;
  return path === to || path.startsWith(`${to}/`);
}

const NAV_COMPACT_MAX_PX = 400;

export function OnlineWebLayout() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = useOnlineWebNavTabs();
  const canRenderPage = useOnlineWebSessionGate();
  const [compactNav, setCompactNav] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NAV_COMPACT_MAX_PX}px)`);
    const update = () => setCompactNav(mq.matches);
    mq.addEventListener("change", update);
    update();
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  const tabLinkClass = (active: boolean) =>
    `focus-ring shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-2 text-pro-13 font-bold transition-colors ${
      active
        ? "bg-navy text-navy-foreground"
        : "bg-white text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-2 text-foreground">
      <header className="relative sticky top-0 z-40 border-b border-border/60 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
          <Link
            to={ONLINE_WEB_ROUTE_IDS.home}
            className="focus-ring flex min-w-0 items-center gap-2 shrink-0"
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
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/"
              className="focus-ring hidden text-pro-13 font-semibold text-muted-foreground hover:text-foreground sm:inline"
            >
              {t("site.nav.home")}
            </Link>
            <OnlineWebNotificationsBell />
            <OnlineWebAccountMenu />
            <LanguageToggle variant="inline" />
          </div>
        </div>

        {compactNav ? (
          <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 pb-3 sm:px-5">
            <button
              type="button"
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-pro-13 font-bold"
              aria-expanded={menuOpen}
              aria-controls="online-web-nav-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
              {t("onlineWeb.nav.menu")}
            </button>
            {menuOpen ? (
              <nav
                id="online-web-nav-menu"
                className="absolute inset-x-0 top-[4.25rem] z-50 border-b border-border bg-white px-4 py-3 shadow-md sm:px-5"
                aria-label={t("onlineWeb.nav.label")}
              >
                <ul className="flex flex-col gap-1">
                  {tabs.map((tab) => {
                    const active = isTabActive(path, tab.to);
                    return (
                      <li key={tab.to}>
                        <Link to={tab.to} className={`${tabLinkClass(active)} block w-full text-center`}>
                          {t(tab.key)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : null}
          </div>
        ) : (
          <nav
            className="online-web-nav-scroll mx-auto flex max-w-6xl gap-2 overflow-x-auto overscroll-x-contain px-4 pb-3 pe-6 sm:px-5"
            aria-label={t("onlineWeb.nav.label")}
          >
            {tabs.map((tab) => {
              const active = isTabActive(path, tab.to);
              return (
                <Link key={tab.to} to={tab.to} className={tabLinkClass(active)}>
                  {t(tab.key)}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-5 lg:py-10">
        {canRenderPage ? (
          <Outlet />
        ) : (
          <div className="space-y-4" aria-busy="true">
            <div className="skeleton h-10 w-2/3 rounded-2xl" />
            <div className="skeleton h-48 rounded-3xl" />
          </div>
        )}
      </main>
      <OnlineWebFooter />
    </div>
  );
}