import { onboardingSection } from "@/lib/provider/onboardingSection";
import { legacyOnboardingRedirect } from "@/lib/provider/legacyOnboardingRedirect";
import { createFileRoute, Navigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { QueryError } from "@/components/famio/QueryError";
import { useMyProvider } from "@/lib/db/provider-queries";
import { proPath } from "@/lib/preview/previewPath";

export const Route = createFileRoute("/pro/onboarding")({
  validateSearch: onboardingSection,
  component: OnboardingRoute,
});

export function OnboardingRoute() {
  const { t } = useTranslation();
  const provider = useMyProvider();
  const search = useSearch({ strict: false });
  if (provider.isLoading || provider.isError) return <ProviderShell hideNav>
    <PageHeader title={t("providerDocuments.title")} backTo="/pro" />
    {provider.isError ? <QueryError onRetry={() => { void provider.refetch(); }} /> : <p role="status" className="p-5">{t("common.loading")}</p>}
  </ProviderShell>;
  const target = legacyOnboardingRedirect(provider.data?.onboarding_status, onboardingSection(search).section);
  if (target.to === "/pro/apply") return <Navigate to={proPath(target.to) as "/pro/apply"} search={{ step: target.step }} replace />;
  if (target.to === "/pro/setup/$item") return <Navigate to={proPath(target.to) as "/pro/setup/$item"} params={{ item: target.item }} replace />;
  return <Navigate to={proPath(target.to) as typeof target.to} replace />;
}
