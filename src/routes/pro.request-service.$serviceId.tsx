import { ProviderServiceRequestForm } from "@/components/provider/ProviderServiceRequestForm";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { QueryError } from "@/components/famio/QueryError";
import { useAllServices, useMyProvider, useMyProviderServices } from "@/lib/db/provider-queries";
import { useProPath } from "@/lib/provider/useProPath";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/pro/request-service/$serviceId")({
  component: ProRequestServicePage,
});

function ProRequestServicePage() {
  const { serviceId } = Route.useParams();
  const proPath = useProPath();
  const nav = useNavigate();
  const { t } = useTranslation();
  const providerQ = useMyProvider();
  const servicesQ = useAllServices();
  const mineQ = useMyProviderServices((providerQ.data as { id?: string } | undefined)?.id);

  const provider = providerQ.data as { id: string; onboarding_status?: string } | undefined;
  const service = (servicesQ.data ?? []).find((s) => s.id === serviceId);
  const existing = (mineQ.data ?? []).find((row) => row.service_id === serviceId);

  if (providerQ.isLoading || servicesQ.isLoading) {
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.common.loading")}</div>
      </ProviderShell>
    );
  }

  if (providerQ.isError || servicesQ.isError) {
    return (
      <ProviderShell>
        <QueryError
          onRetry={() => {
            void providerQ.refetch();
            void servicesQ.refetch();
          }}
        />
      </ProviderShell>
    );
  }

  if (!provider || provider.onboarding_status !== "APPROVED") {
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.serviceRequest.notApproved")}</div>
      </ProviderShell>
    );
  }

  if (!service) {
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.serviceRequest.serviceUnavailable")}</div>
      </ProviderShell>
    );
  }

  if (existing?.status === "approved") {
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.serviceRequest.alreadyActive")}</div>
        <Link to={proPath("/pro/profile")} className="block text-center text-brand">
          {t("common.back")}
        </Link>
      </ProviderShell>
    );
  }

  if (existing?.status === "pending") {
    return (
      <ProviderShell>
        <div className="p-8 text-center text-sm">{t("pro.serviceRequest.alreadyPending")}</div>
        <Link to={proPath("/pro/profile")} className="block text-center text-brand">
          {t("common.back")}
        </Link>
      </ProviderShell>
    );
  }

  return (
    <ProviderShell>
      <main className="apply-ui apply-screen !pb-28">
        <header className="apply-header">
          <Link to={proPath("/pro/profile")} className="text-sm font-bold text-brand">
            {t("common.back")}
          </Link>
          <h1 className="apply-title">{t("pro.serviceRequest.pageTitle")}</h1>
        </header>
        <div className="apply-content px-4">
          <ProviderServiceRequestForm
            providerId={provider.id}
            service={service}
            onSubmitted={() => nav({ to: proPath("/pro/profile") as "/pro/profile" })}
          />
        </div>
      </main>
    </ProviderShell>
  );
}
