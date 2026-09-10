import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useMyRole } from "@/lib/db/provider-queries";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { adminPath, normalizeAdminPathname } from "@/lib/preview/previewPath";
import {
  ClipboardList,
  ShieldCheck,
  Wallet,
  UserRound,
  Settings,
  Layers,
  MapPin,
  CreditCard,
  Tag,
  Ban,
  Megaphone,
  LifeBuoy,
  Activity,
  History,
  Radar,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeft,
  LogOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import famyLogo from "@/assets/famy-wordmark.png";

type NavItem = { to: string; labelKey: string; icon: LucideIcon; exact?: boolean };
type NavGroup = { titleKey: string; items: NavItem[] };

export const ADMIN_NAV_GROUPS: (NavGroup & { titleFallback: string })[] = [
  {
    titleKey: "admin.layout.group.overview",
    titleFallback: "Overview",
    items: [{ to: "/admin", labelKey: "admin.layout.nav.overview", icon: LayoutDashboard, exact: true }],
  },
  {
    titleKey: "admin.layout.group.operations",
    titleFallback: "Operations",
    items: [
      { to: "/admin/operations", labelKey: "admin.layout.nav.operations", icon: Activity },
      { to: "/admin/monitoring", labelKey: "admin.layout.nav.monitoring", icon: Radar },
    ],
  },
  {
    titleKey: "admin.layout.group.people",
    titleFallback: "People",
    items: [
      { to: "/admin/providers", labelKey: "admin.layout.nav.providers", icon: ShieldCheck },
      { to: "/admin/customers", labelKey: "admin.layout.nav.customers", icon: UserRound },
    ],
  },
  {
    titleKey: "admin.layout.group.transactions",
    titleFallback: "Transactions",
    items: [
      { to: "/admin/bookings", labelKey: "admin.layout.nav.bookings", icon: ClipboardList },
      { to: "/admin/cases", labelKey: "admin.layout.nav.cases", icon: LifeBuoy },
      { to: "/admin/payments", labelKey: "admin.layout.nav.payments", icon: Wallet },
      { to: "/admin/payment-methods", labelKey: "admin.layout.nav.paymentMethods", icon: CreditCard },
      { to: "/admin/cancellation-reasons", labelKey: "admin.layout.nav.cancellationReasons", icon: Ban },
    ],
  },
  {
    titleKey: "admin.layout.group.catalog",
    titleFallback: "Catalog",
    items: [
      { to: "/admin/services", labelKey: "admin.layout.nav.services", icon: Layers },
      { to: "/admin/zones", labelKey: "admin.layout.nav.zones", icon: MapPin },
      { to: "/admin/promo-codes", labelKey: "admin.layout.nav.promoCodes", icon: Tag },
    ],
  },
  {
    titleKey: "admin.layout.group.system",
    titleFallback: "System",
    items: [
      { to: "/admin/campaigns", labelKey: "admin.layout.nav.campaigns", icon: Megaphone },
      { to: "/admin/audit-log", labelKey: "admin.layout.nav.auditLog", icon: History },
      { to: "/admin/settings", labelKey: "admin.layout.nav.settings", icon: Settings },
    ],
  },
];

export function AdminShell({ children, previewMode = false }: { children: ReactNode; previewMode?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const role = useMyRole();
  const rawPathname = useRouterState({ select: (s) => s.location.pathname });
  const pathname = normalizeAdminPathname(rawPathname);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (previewMode) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) nav({ to: "/login", replace: true });
    })();
  }, [nav, previewMode]);

  if (!previewMode && role.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#FEFAFC]" role="status" aria-live="polite">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  if (!previewMode && role.data !== "admin") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#FEFAFC] px-8 text-center">
        <ShieldCheck className="h-10 w-10 text-brand" />
        <h1 className="text-xl font-extrabold">{t("admin.layout.adminOnlyTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.layout.adminOnlyBody")}</p>
        <Link to="/home" className="focus-ring mt-2 text-sm font-semibold text-brand">
          {t("admin.layout.backToApp")}
        </Link>
      </div>
    );
  }

  const flatTabs = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
  const isActive = (tab: NavItem) => (tab.exact ? pathname === tab.to : pathname.startsWith(tab.to));
  const currentTab = flatTabs.find((tab) => isActive(tab));

  return (
    <div className="min-h-dvh bg-[#FEFAFC] text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/50 bg-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={famyLogo} alt="Famy" className="h-6 w-auto shrink-0 object-contain" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-extrabold text-foreground">{t("admin.layout.badge")}</p>
              {currentTab ? (
                <p className="truncate text-[11px] font-medium text-muted-foreground">{t(currentTab.labelKey)}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {previewMode ? (
              <Link
                to="/preview"
                className="focus-ring rounded-lg px-2 py-1.5 text-xs font-bold text-brand hover:bg-brand/10"
              >
                {t("preview.allScreens", "All screens")}
              </Link>
            ) : null}
            <LanguageToggle variant="inline" />
            {!previewMode ? (
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  nav({ to: "/login", replace: true });
                }}
                className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t("admin.layout.signOut")}</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem] gap-0 lg:gap-6 lg:px-6 lg:py-5">
        <aside
          className={`hidden shrink-0 border-border/50 bg-surface lg:block lg:rounded-xl lg:border lg:shadow-sm ${
            collapsed ? "w-[4.5rem]" : "w-60"
          }`}
        >
          <div className="flex items-center justify-end border-b border-border/40 p-2">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              aria-label={
                collapsed
                  ? t("admin.layout.expandSidebar", "Expand sidebar")
                  : t("admin.layout.collapseSidebar", "Collapse sidebar")
              }
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          <nav
            className="max-h-[calc(100dvh-8rem)] overflow-y-auto p-2"
            aria-label={t("admin.layout.navAria", "Admin navigation")}
          >
            {ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.titleKey} className="mb-3 last:mb-0">
                {!collapsed ? (
                  <p className="mb-1 px-2 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    {t(group.titleKey, group.titleFallback)}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {group.items.map((tab) => {
                    const active = isActive(tab);
                    const Icon = tab.icon;
                    const href = adminPath(tab.to);
                    return (
                      <li key={tab.to}>
                        <Link
                          to={href as "/admin"}
                          title={collapsed ? t(tab.labelKey) : undefined}
                          className={`focus-ring flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors ${
                            active
                              ? "bg-brand text-brand-foreground shadow-sm"
                              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                          }`}
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {!collapsed ? <span className="truncate">{t(tab.labelKey)}</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 bg-surface lg:rounded-xl lg:border lg:border-border/50 lg:shadow-sm">
          <nav
            className="flex gap-1.5 overflow-x-auto border-b border-border/50 p-2 lg:hidden"
            aria-label={t("admin.layout.navAria", "Admin navigation")}
          >
            {flatTabs.map((tab) => {
              const active = isActive(tab);
              const href = adminPath(tab.to);
              return (
                <Link
                  key={tab.to}
                  to={href as "/admin"}
                  className={`focus-ring whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${
                    active ? "bg-brand text-brand-foreground" : "bg-surface-2 text-muted-foreground"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {t(tab.labelKey)}
                </Link>
              );
            })}
          </nav>
          {children}
        </main>
      </div>
    </div>
  );
}
