import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRole } from "@/lib/db/provider-queries";
import { Users, ClipboardList, ShieldCheck, Wallet, UserRound, Settings, Layers, MapPin, CreditCard, Tag, Ban, Megaphone } from "lucide-react";
import famyLogo from "@/assets/famy-wordmark.png";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

function AdminLayout() {
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
      <div dir="ltr" className="grid min-h-dvh place-items-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy/20 border-t-navy" />
      </div>
    );
  }

  if (role.data !== "admin") {
    return (
      <div dir="ltr" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <ShieldCheck className="h-10 w-10 text-coral" />
        <h1 className="text-xl font-extrabold">Admin only</h1>
        <p className="text-sm text-muted-foreground">Your account does not have admin access.</p>
        <Link to="/home" className="mt-2 text-sm font-semibold text-navy">Back to app</Link>
      </div>
    );
  }

  const tabs = [
    { to: "/admin", label: "Overview", icon: Users, exact: true },
    { to: "/admin/providers", label: "Providers", icon: ShieldCheck },
    { to: "/admin/customers", label: "Customers", icon: UserRound },
    { to: "/admin/bookings", label: "Bookings", icon: ClipboardList },
    { to: "/admin/cancellation-reasons", label: "Cancellation Reasons", icon: Ban },
    { to: "/admin/payments", label: "Payments", icon: Wallet },
    { to: "/admin/payment-methods", label: "Payment Methods", icon: CreditCard },
    { to: "/admin/services", label: "Services", icon: Layers },
    { to: "/admin/promo-codes", label: "Promo Codes", icon: Tag },
    { to: "/admin/zones", label: "Zones", icon: MapPin },
    { to: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
    { to: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div dir="ltr" className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <img src={famyLogo} alt="Famy" className="h-7 w-auto object-contain" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-coral">Admin</span>
          </div>
          <button
            onClick={async () => { await supabase.auth.signOut(); nav({ to: "/login", replace: true }); }}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >Sign out</button>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="flex flex-col gap-1">
            {tabs.map((t) => {
              const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
              const Icon = t.icon;
              return (
                <Link key={t.to} to={t.to}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-navy text-navy-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  <Icon className="h-4 w-4" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 rounded-2xl border border-border/60 bg-surface shadow-card">
          <nav className="flex gap-2 overflow-x-auto border-b border-border/60 p-3 md:hidden">
            {tabs.map((t) => {
              const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
              return (
                <Link key={t.to} to={t.to}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}>
                  {t.label}
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
