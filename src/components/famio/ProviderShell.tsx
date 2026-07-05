import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ClipboardList, CalendarRange, Wallet, User } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";

export function ProviderShell({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  return (
    <PhoneFrame>
      <main className={`flex-1 ${hideNav ? "" : "pb-24"}`}>{children}</main>
      {!hideNav && <ProviderBottomNav />}
    </PhoneFrame>
  );
}

const tabs = [
  { to: "/pro", labelKey: "pro.nav.dashboard", icon: LayoutDashboard },
  { to: "/pro/bookings", labelKey: "pro.nav.jobs", icon: ClipboardList },
  { to: "/pro/availability", labelKey: "pro.nav.schedule", icon: CalendarRange },
  { to: "/pro/earnings", labelKey: "pro.nav.earnings", icon: Wallet },
  { to: "/pro/profile", labelKey: "pro.nav.profile", icon: User },
] as const;

export function ProviderBottomNav() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40" aria-label={t("pro.nav.navAria")}>
      <div className="mx-auto max-w-md">
        <div className="safe-bottom mx-3 mb-3 rounded-3xl border border-border/60 bg-surface/95 shadow-float backdrop-blur-xl">
          <ul className="grid grid-cols-5">
            {tabs.map((tab) => {
              const active = tab.to === "/pro" ? pathname === "/pro" : pathname.startsWith(tab.to);
              const Icon = tab.icon;
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to}
                    aria-current={active ? "page" : undefined}
                    className="focus-ring flex min-h-11 flex-col items-center gap-1 px-1 pt-3 pb-2 rounded-2xl"
                  >
                    <span
                      className={`grid h-9 w-12 place-items-center rounded-2xl transition-all ${
                        active ? "bg-navy text-navy-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </span>
                    <span className={`text-[10px] font-semibold ${active ? "text-navy" : "text-muted-foreground"}`}>
                      {t(tab.labelKey)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
