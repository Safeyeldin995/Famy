import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { QueryError } from "@/components/famio/QueryError";
import { ProviderOnboardingFlow } from "@/components/provider/ProviderOnboardingFlow";
import { isPreviewRoute } from "@/lib/preview/constants";
import { useMyProvider } from "@/lib/db/provider-queries";
import { useOnboardingSnapshot } from "@/lib/provider/onboarding-queries";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/pro/onboarding")({ component: OnboardingRoute });

export function OnboardingRoute() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();
  const snapshotQ = useOnboardingSnapshot();

  useEffect(() => {
    if (isPreviewRoute()) return;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;
      if (!providerQ.data && !providerQ.isLoading) {
        await supabase.rpc("provider_start_onboarding");
        await providerQ.refetch();
        await snapshotQ.refetch();
      }
    })();
  }, [providerQ.data, providerQ.isLoading, providerQ.refetch, snapshotQ.refetch]);

  if (providerQ.isLoading) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <ProviderPageHero title={t("pro.onboardingWizard.title")} backTo="/pro" compact />
        <div className="grid min-h-[50vh] place-items-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden="true" />
        </div>
      </PhoneFrame>
    );
  }

  if (providerQ.isError) {
    return (
      <PhoneFrame bg="bg-[#FEFAFC]">
        <ProviderPageHero title={t("pro.onboardingWizard.title")} backTo="/pro" compact />
        <QueryError onRetry={() => providerQ.refetch()} />
      </PhoneFrame>
    );
  }

  return <ProviderOnboardingFlow />;
}
