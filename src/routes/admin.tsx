import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useMyRole } from "@/lib/db/provider-queries";
import { LanguageToggle } from "@/components/famio/LanguageToggle";
import { Users, ClipboardList, ShieldCheck, Wallet, UserRound, Settings, Layers, MapPin, CreditCard, Tag, Ban, Megaphone, LifeBuoy, Activity, History } from "lucide-react";
import famyLogo from "@/assets/famy-wordmark.png";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const role = useMyRole();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) nav({ to: "/login", replace: true });
    })();
  }, [nav]);

  if (role.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-live="polite">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy/20 border-t-navy" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  if (role.data !== "admin") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <ShieldCheck className="h-10 w-10 text-coral" />
        <h1 className="text-xl font-extrabold">{t("admin.layout.adminOnlyTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.layout.adminOnlyBody")}</p>
        <Link to="/home" className="mt-2 text-sm font-semibold text-navy">{t("admin.layout.backToApp")}</Link>
      </div>
    );
  }

  const tabs = [
    { to: "/admin", label: t("admin.layout.nav.overview"), icon: Users, exact: true },
    { to: "/admin/operations", label: t("admin.layout.nav.operations"), icon: Activity },
    { to: "/admin/providers", label: t("admin.layout.nav.providers"), icon: ShieldCheck },
    { to: "/admin/customers", label: t("admin.layout.nav.customers"), icon: UserRound },
    { to: "/admin/bookings", label: t("admin.layout.nav.bookings"), icon: ClipboardList },
    { to: "/admin/cases", label: t("admin.layout.nav.cases"), icon: LifeBuoy },
    { to: "/admin/cancellation-reasons", label: t("admin.layout.nav.cancellationReasons"), icon: Ban },
    { to: "/admin/payments", label: t("admin.layout.nav.payments"), icon: Wallet },
    { to: "/admin/payment-methods", label: t("admin.layout.nav.paymentMethods"), icon: CreditCard },
    { to: "/admin/services", label: t("admin.layout.nav.services"), icon: Layers },
    { to: "/admin/promo-codes", label: t("admin.layout.nav.promoCodes"), icon: Tag },
    { to: "/admin/zones", label: t("admin.layout.nav.zones"), icon: MapPin },
    { to: "/admin/campaigns", label: t("admin.layout.nav.campaigns"), icon: Megaphone },
    { to: "/admin/audit-log", label: t("admin.layout.nav.auditLog"), icon: History },
    { to: "/admin/settings", label: t("admin.layout.nav.settings"), icon: Settings },
  ];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <img src={famyLogo} alt="Famy" className="h-7 w-auto object-contain" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-coral">{t("admin.layout.badge")}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle variant="inline" />
            <button
              onClick={async () => { await supabase.auth.signOut(); nav({ to: "/login", replace: true }); }}
              className="focus-ring rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground"
            >{t("admin.layout.signOut")}</button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="flex flex-col gap-1">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
              const Icon = tab.icon;
              return (
                <Link key={tab.to} to={tab.to}
                  className={`focus-ring flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-navy text-navy-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 rounded-2xl border border-border/60 bg-surface shadow-card">
          <nav className="flex gap-2 overflow-x-auto border-b border-border/60 p-3 md:hidden">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
              return (
                <Link key={tab.to} to={tab.to}
                  className={`focus-ring whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}>
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
