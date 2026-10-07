import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ProviderApplyFlow, type ApplyDraft } from "@/components/provider/ProviderApplyFlow";
import { QueryError } from "@/components/famio/QueryError";
import {
  useMyProvider,
  useProviderDocuments,
  useSetProviderPrice,
} from "@/lib/db/provider-queries";
import {
  useActiveZones,
  usePhase1Services,
  useOnboardingSnapshot,
  useMySavedSelections,
  useSaveOnboardingSection,
  useSubmitOnboarding,
  useSecureUploadDocument,
} from "@/lib/provider/onboarding-queries";
import { needsServicePrice } from "@/lib/provider/priceOptions";
import { defaultWorkingHours } from "@/lib/provider/setupHelpers";
import { useReplaceAvailability } from "@/lib/db/provider-queries";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pro/apply")({ component: ProviderApplyRoute });
function ProviderApplyRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const provider = useMyProvider();
  const snapshot = useOnboardingSnapshot();
  const services = usePhase1Services();
  const zones = useActiveZones();
  const selections = useMySavedSelections(provider.data?.id);
  const docs = useProviderDocuments(provider.data?.id);
  const save = useSaveOnboardingSection();
  const submit = useSubmitOnboarding();
  const price = useSetProviderPrice();
  const upload = useSecureUploadDocument();
  const replaceAvailability = useReplaceAvailability();
  const started = useRef(false);
  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("provider_start_onboarding");
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
      await qc.invalidateQueries({ queryKey: ["provider-onboarding-snapshot"] });
    },
  });
  useEffect(() => {
    if (provider.isSuccess && !provider.data && !started.current) {
      started.current = true;
      start.mutate();
    }
  }, [provider.isSuccess, provider.data, start.mutate]);
  const queries = [provider, snapshot, services, zones, selections, docs];
  if (start.isError || queries.some((q) => q.isError))
    return (
      <QueryError
        onRetry={() => {
          if (start.isError) start.mutate();
          else queries.forEach((q) => void q.refetch());
        }}
      />
    );
  if (!provider.data || queries.some((q) => !q.isSuccess))
    return (
      <div className="apply-ui apply-screen p-5" role="status">
        {t("providerApply.loading")}
      </div>
    );
  if (
    provider.data.onboarding_status !== "DRAFT" &&
    provider.data.onboarding_status !== "NEEDS_CHANGES"
  )
    return <Navigate to="/pro" replace />;
  const snapshotData = snapshot.data as {
    profile?: { full_name?: string };
    details?: { accuracy_confirmed_at?: string };
  };
  const savedServices = selections.data!.services;
  const serviceRows = services.data!;
  const initial: ApplyDraft = {
    name: snapshotData.profile?.full_name ?? provider.data.profile?.full_name ?? "",
    zones: selections
      .data!.zones.map((z) => z.zone_id)
      .filter((id) => zones.data!.some((z) => z.id === id)),
    services: savedServices
      .map((s) => s.service_id)
      .filter((id) => serviceRows.some((s) => s.id === id)),
    prices: Object.fromEntries(savedServices.map((s) => [s.service_id, s.price_override])),
    front: docs.data!.some((d) => d.type === "id_card_front" && d.status !== "rejected"),
    back: docs.data!.some((d) => d.type === "id_card_back" && d.status !== "rejected"),
    agreed: !!snapshotData.details?.accuracy_confirmed_at,
  };
  const persist = async (step: number, draft: ApplyDraft) => {
    if (step === 1) {
      await save.mutateAsync({ section: "personal", payload: { legal_name: draft.name } });
      await save.mutateAsync({ section: "coverage", payload: { zone_ids: draft.zones } });
    } else if (step === 2) {
      await save.mutateAsync({ section: "services", payload: { service_ids: draft.services } });
      for (const existing of savedServices) {
        if (
          serviceRows.some((s) => s.id === existing.service_id) &&
          !draft.services.includes(existing.service_id) &&
          existing.status !== "approved"
        ) {
          const { error } = await supabase.rpc("provider_remove_onboarding_service", {
            p_service_id: existing.service_id,
          });
          if (error) throw error;
        }
      }
      for (const service of serviceRows) {
        if (draft.services.includes(service.id) && needsServicePrice(service))
          await price.mutateAsync({
            providerId: provider.data!.id,
            serviceId: service.id,
            price: draft.prices[service.id],
          });
      }
      await qc.invalidateQueries({ queryKey: ["provider-saved-selections"] });
    } else {
      await save.mutateAsync({ section: "review", payload: { confirmed: draft.agreed } });
      await submit.mutateAsync();
      const existing = await supabase.from("availability_rules").select("id").eq("provider_id", provider.data!.id).limit(1);
      if (existing.error) throw existing.error;
      if (!existing.data.length) await replaceAvailability.mutateAsync({ providerId: provider.data!.id, rules: defaultWorkingHours() });
      await navigate({ to: "/pro", replace: true });
    }
  };
  return (
    <ProviderApplyFlow
      initial={initial}
      services={serviceRows}
      zones={zones.data!}
      lockedServices={savedServices.filter((s) => s.status === "approved").map((s) => s.service_id)}
      onSave={persist}
      onCapture={async (type, file) => {
        await upload.mutateAsync({ type, file });
      }}
    />
  );
}
