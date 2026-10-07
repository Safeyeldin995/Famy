import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useMyProvider, useMyRole } from "@/lib/db/provider-queries";
import { useMyPushSubscriptions } from "@/lib/db/queries";
import { PushEnablePrompt } from "@/components/famio/PushEnablePrompt";
import { shouldOfferPushPrompt } from "@/lib/push-prompt";
import { PhoneFrame } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { FamyWordmark } from "@/components/famio/FamyWordmark";
import { Loader2 } from "lucide-react";
import { customerPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/pro")({ component: ProviderLayout });

function ProviderLayout() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const role = useMyRole();
  const provider = useMyProvider();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const devicesQ = useMyPushSubscriptions();
  const [pushPromptOpen, setPushPromptOpen] = useState(false);

  const onApply = pathname.startsWith("/pro/apply");
  const onOnboarding = pathname.startsWith("/pro/onboarding") || onApply;
  const onboardingStatus = (provider.data as any)?.onboarding_status as string | undefined;

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
    return () => {
      unsub?.unsubscribe?.();
    };
  }, [nav]);

  useEffect(() => {
    if (role.isLoading || provider.isLoading) return;
    if (role.isError || provider.isError || onApply) return;
    if ((!provider.data && role.data === "provider") || onboardingStatus === "DRAFT") {
      nav({ to: "/pro/apply", replace: true });
      return;
    }
    if (!provider.data || onOnboarding) return;
    if (onboardingStatus === "NEEDS_CHANGES") {
      nav({ to: "/pro/onboarding", replace: true });
    }
  }, [role.isLoading, provider.isLoading, provider.data, role.data, role.isError, provider.isError, onboardingStatus, onOnboarding, onApply, nav]);

  useEffect(() => {
    if (onOnboarding || role.isLoading || provider.isLoading || !provider.data) return;
    if (onboardingStatus !== "APPROVED") return;
    if (devicesQ.isLoading) return;
    const hasDevice = (devicesQ.data ?? []).length > 0;
    if (shouldOfferPushPrompt("provider", { hasDeviceSubscription: hasDevice })) {
      setPushPromptOpen(true);
    }
  }, [
    onOnboarding,
    role.isLoading,
    provider.isLoading,
    provider.data,
    onboardingStatus,
    devicesQ.isLoading,
    devicesQ.data,
  ]);

  if (role.isLoading || provider.isLoading) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <div className="grid min-h-dvh place-items-center px-8">
          <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden="true" />
        </div>
      </PhoneFrame>
    );
  }

  if (role.isError) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <QueryError onRetry={() => role.refetch()} />
      </PhoneFrame>
    );
  }

  if (provider.isError) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <QueryError onRetry={() => provider.refetch()} />
      </PhoneFrame>
    );
  }

  if (!provider.data && !onOnboarding) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="brand-hero flex w-full max-w-xs flex-col items-center rounded-[1.75rem] px-6 py-8">
            <FamyWordmark size="compact" variant="white" />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground">{t("pro.gateway.title")}</h1>
          <p className="text-sm font-medium text-muted-foreground">{t("pro.gateway.body")}</p>
          <Link
            to="/pro/apply"
            className="focus-ring tap-scale mt-2 inline-flex h-12 w-full max-w-xs items-center justify-center rounded-2xl bg-brand text-sm font-extrabold text-brand-foreground shadow-sm"
          >
            {t("pro.gateway.become")}
          </Link>
          <Link
            to={customerPath("/home") as "/home"}
            className="text-xs font-semibold text-muted-foreground"
          >
            {t("pro.gateway.backCustomer")}
          </Link>
        </div>
      </PhoneFrame>
    );
  }

  return (
    <>
      <Outlet />
      <PushEnablePrompt
        open={pushPromptOpen}
        audience="provider"
        onOpenChange={setPushPromptOpen}
      />
    </>
  );
}
