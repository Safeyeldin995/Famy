import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PhoneFrame, TopBar } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { OnboardingWizard } from "@/components/provider/OnboardingWizard";
import { useMyProvider } from "@/lib/db/provider-queries";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pro/onboarding")({ component: OnboardingRoute });

function OnboardingRoute() {
  const { t } = useTranslation();
  const providerQ = useMyProvider();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      if (!providerQ.data && !providerQ.isLoading) {
        await supabase.rpc("provider_start_onboarding");
        providerQ.refetch();
      }
    })();
  }, [providerQ.data, providerQ.isLoading]);

  if (providerQ.isLoading) {
    return (
      <PhoneFrame>
        <TopBar back={{ to: "/pro" }} title={t("pro.onboardingWizard.title")} />
        <div className="grid min-h-[50vh] place-items-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy/20 border-t-navy" />
        </div>
      </PhoneFrame>
    );
  }

  if (providerQ.isError) {
    return (
      <PhoneFrame>
        <TopBar back={{ to: "/pro" }} title={t("pro.onboardingWizard.title")} />
        <QueryError onRetry={() => providerQ.refetch()} />
      </PhoneFrame>
    );
  }

  return <OnboardingWizard />;
}
