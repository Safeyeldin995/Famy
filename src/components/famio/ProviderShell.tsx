import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ClipboardList, CalendarRange, Wallet, User } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { normalizeProPathname, proPath } from "@/lib/preview/previewPath";

export function ProviderShell({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  return (
    <PhoneFrame bg="bg-[#FEFAFC]">
      <main className={`flex-1 ${hideNav ? "" : "pb-[5.5rem]"}`}>{children}</main>
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
  const navPath = normalizeProPathname(pathname);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40" aria-label={t("pro.nav.navAria")}>
      <div className="mx-auto max-w-md">
        <div className="safe-bottom border-t border-border/50 bg-surface/95 backdrop-blur-md">
          <ul className="grid grid-cols-5">
            {tabs.map((tab) => {
              const active =
                tab.to === "/pro" ? navPath === "/pro" || navPath === "/pro/" : navPath.startsWith(tab.to);
              const Icon = tab.icon;
              return (
                <li key={tab.to}>
                  <Link
                    to={proPath(tab.to) as "/pro"}
                    aria-current={active ? "page" : undefined}
                    className="focus-ring flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 py-2"
                  >
                    <Icon
                      className={`h-5 w-5 ${active ? "text-brand" : "text-muted-foreground"}`}
                      strokeWidth={active ? ICON_STROKE_BOLD : 2}
                      aria-hidden="true"
                    />
                    <span
                      className={`max-w-full truncate text-[10px] font-bold ${active ? "text-brand" : "text-muted-foreground"}`}
                    >
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
