import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { QueryError } from "@/components/famio/QueryError";
import { OnboardingWizard } from "@/components/provider/OnboardingWizard";
import { useMyProvider } from "@/lib/db/provider-queries";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/pro/onboarding")({ component: OnboardingRoute });

function OnboardingRoute() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;
      if (!providerQ.data && !providerQ.isLoading) {
        await supabase.rpc("provider_start_onboarding");
        providerQ.refetch();
      }
    })();
  }, [providerQ.data, providerQ.isLoading]);

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

  return <OnboardingWizard />;
}
