import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useMyProvider, useMyRole } from "@/lib/db/provider-queries";
import { PhoneFrame } from "@/components/famio/ui";

export const Route = createFileRoute("/pro")({ component: ProviderLayout });

function ProviderLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const role = useMyRole();
  const provider = useMyProvider();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    let unsub: any;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) nav({ to: "/login", replace: true });
      const sub = supabase.auth.onAuthStateChange((_e, session) => {
        if (!session) nav({ to: "/login", replace: true });
      });
      unsub = sub.data.subscription;
    })();
    return () => { unsub?.unsubscribe?.(); };
  }, [nav]);

  if (role.isLoading || provider.isLoading) {
    return (
      <PhoneFrame>
        <div className="grid min-h-dvh place-items-center px-8">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy/20 border-t-navy" />
        </div>
      </PhoneFrame>
    );
  }

  // Signed in but never enrolled as provider → onboarding gateway
  const onOnboarding = pathname.startsWith("/pro/onboarding");

  if (!provider.data && !onOnboarding) {

    return (
      <PhoneFrame>
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="grid h-24 w-24 place-items-center rounded-3xl bg-navy text-3xl font-extrabold text-navy-foreground">F</div>
          <h1 className="text-2xl font-extrabold">{t("pro.gateway.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pro.gateway.body")}</p>
          <Link to="/pro/onboarding" className="mt-2 inline-flex h-14 w-full max-w-xs items-center justify-center rounded-2xl bg-navy text-base font-bold text-navy-foreground shadow-card">
            {t("pro.gateway.become")}
          </Link>
          <Link to="/home" className="text-xs font-semibold text-muted-foreground">{t("pro.gateway.backCustomer")}</Link>
        </div>
      </PhoneFrame>
    );
  }

  return <Outlet />;
}
