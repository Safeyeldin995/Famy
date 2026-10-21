import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { defaultWorkingHours } from "@shared/provider/setupHelpers";
import { needsServicePrice, type ApplyDraft } from "@/lib/provider/applyDraft";
import { ProviderApplyFlow } from "@/ui/provider/ProviderApplyFlow";
import {
  useActiveZones,
  useMySavedSelections,
  useOnboardingSnapshot,
  usePhase1Services,
  useSaveOnboardingSection,
  useSecureUploadDocument,
  useStartOnboarding,
  useSubmitOnboarding,
} from "@/lib/provider/onboardingQueries";
import { useProviderDocuments, useSetProviderPrice } from "@/lib/provider/profileQueries";
import { useMyProvider, useReplaceAvailability } from "@/lib/provider/queries";
import { supabase } from "@/lib/supabase";
import { Page, QueryState } from "@/ui/Page";

export default function ProApplyScreen() {
  const { t } = useTranslation();
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>();
  const step = Math.min(3, Math.max(1, Number(stepParam) || 1)) as 1 | 2 | 3;
  const qc = useQueryClient();
  const providerQ = useMyProvider();
  const provider = providerQ.data as Record<string, unknown> | null | undefined;
  const snapshot = useOnboardingSnapshot();
  const services = usePhase1Services();
  const zones = useActiveZones();
  const selections = useMySavedSelections(provider?.id as string | undefined);
  const docs = useProviderDocuments(provider?.id as string | undefined);
  const save = useSaveOnboardingSection();
  const submit = useSubmitOnboarding();
  const price = useSetProviderPrice();
  const replaceAvailability = useReplaceAvailability();
  const upload = useSecureUploadDocument();
  const start = useStartOnboarding();
  const started = useRef(false);

  useEffect(() => {
    if (providerQ.isSuccess && !provider && !started.current) {
      started.current = true;
      start.mutate();
    }
  }, [providerQ.isSuccess, provider, start]);

  const queries = [providerQ, snapshot, services, zones, selections, docs];
  const status = provider?.onboarding_status as string | undefined;
  const dataReady = !!provider && queries.every((q) => q.isSuccess && !q.isLoading && !q.isPending);

  if (provider && status && status !== "DRAFT" && status !== "NEEDS_CHANGES") {
    router.replace("/pro-setup-home");
    return null;
  }

  const persist = async (saveStep: number, draft: ApplyDraft) => {
    const providerId = provider!.id as string;
    const savedServices = selections.data!.services;
    const serviceRows = services.data!;
    if (saveStep === 1) {
      await save.mutateAsync({ section: "personal", payload: { legal_name: draft.name } });
      await save.mutateAsync({ section: "coverage", payload: { zone_ids: draft.zones } });
    } else if (saveStep === 2) {
      await save.mutateAsync({ section: "services", payload: { service_ids: draft.services } });
      for (const existing of savedServices) {
        if (
          serviceRows.some((s: { id: string }) => s.id === existing.service_id) &&
          !draft.services.includes(existing.service_id) &&
          existing.status !== "approved"
        ) {
          const { error } = await supabase.rpc("provider_remove_onboarding_service", {
            p_service_id: existing.service_id,
          });
          if (error) throw error;
        }
      }
      for (const service of serviceRows as import("@/lib/provider/applyDraft").ApplyService[]) {
        if (draft.services.includes(service.id) && needsServicePrice(service)) {
          await price.mutateAsync({
            providerId,
            serviceId: service.id,
            price: draft.prices[service.id] ?? null,
          });
        }
      }
      await qc.invalidateQueries({ queryKey: ["provider-saved-selections"] });
    } else {
      await save.mutateAsync({ section: "review", payload: { confirmed: draft.agreed } });
      await submit.mutateAsync();
      try {
        const existing = await supabase
          .from("availability_rules")
          .select("id")
          .eq("provider_id", providerId)
          .limit(1);
        if (existing.error) throw existing.error;
        if (!existing.data?.length) {
          await replaceAvailability.mutateAsync({
            providerId,
            rules: defaultWorkingHours(),
          });
        }
      } catch {
        // submission succeeded; hours task remains on pending home
      }
      router.replace("/pro-setup-home");
    }
  };

  let flow = null;
  if (dataReady) {
    const snapshotData = snapshot.data as {
      profile?: { full_name?: string };
      details?: { accuracy_confirmed_at?: string };
    };
    const profile = provider!.profile as { full_name?: string } | undefined;
    const savedServices = selections.data!.services;
    const serviceRows = services.data!;
    const initial: ApplyDraft = {
      name: snapshotData.profile?.full_name ?? profile?.full_name ?? "",
      zones: selections
        .data!.zones.map((z: { zone_id: string }) => z.zone_id)
        .filter((id: string) => zones.data!.some((z: { id: string }) => z.id === id)),
      services: savedServices
        .map((s: { service_id: string }) => s.service_id)
        .filter((id: string) => serviceRows.some((s: { id: string }) => s.id === id)),
      prices: Object.fromEntries(
        savedServices.map((s: { service_id: string; price_override: number | null }) => [
          s.service_id,
          s.price_override,
        ]),
      ),
      front: docs.data!.some(
        (d: { type: string; status: string }) =>
          d.type === "id_card_front" && d.status !== "rejected",
      ),
      back: docs.data!.some(
        (d: { type: string; status: string }) =>
          d.type === "id_card_back" && d.status !== "rejected",
      ),
      agreed: !!snapshotData.details?.accuracy_confirmed_at,
    };
    flow = (
      <ProviderApplyFlow
        key={step}
        initialStep={step}
        initial={initial}
        services={serviceRows as import("@/lib/provider/applyDraft").ApplyService[]}
        zones={zones.data!}
        lockedServices={savedServices
          .filter((s: { status: string }) => s.status === "approved")
          .map((s: { service_id: string }) => s.service_id)}
        onSave={persist}
        onCapture={async (type, file) => {
          await upload.mutateAsync({ type, file });
        }}
      />
    );
  }

  return (
    <Page title={t("providerApply.checklist")} queries={queries}>
      <QueryState query={providerQ}>{dataReady ? flow : null}</QueryState>
    </Page>
  );
}
