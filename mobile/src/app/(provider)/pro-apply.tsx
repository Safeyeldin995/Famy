import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { providerHeaderShowsBack } from "@/lib/provider/providerHeaderBack";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { defaultWorkingHours } from "@shared/provider/setupHelpers";
import {
  applyStepReady,
  needsServicePrice,
  normalizeApplyWorkMode,
  servicesForMode,
  type ApplyDraft,
  type ApplyService,
} from "@/lib/provider/applyDraft";
import { resumeApplyStep } from "@shared/provider/applyServiceDoors";
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
import {
  useMyRequirementFulfillments,
  useProviderDocuments,
  useSetProviderPrice,
} from "@/lib/provider/profileQueries";
import { useRequirementsForServices } from "@/lib/bookingQueries";
import { useMyProvider, useReplaceAvailability } from "@/lib/provider/queries";
import { supabase } from "@/lib/supabase";
import { Page, QueryState } from "@/ui/Page";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { ProviderAccountMenu } from "@/ui/provider/ProviderAccountMenu";

export default function ProApplyScreen() {
  const { t } = useTranslation();
  const { step: stepParam } = useLocalSearchParams<{ step?: string }>();
  const requestedStep = Number(stepParam)
    ? (Math.min(3, Math.max(1, Number(stepParam))) as 1 | 2 | 3)
    : null;
  const qc = useQueryClient();
  const providerQ = useMyProvider();
  const provider = providerQ.data as Record<string, unknown> | null | undefined;
  const snapshot = useOnboardingSnapshot();
  const services = usePhase1Services();
  const zones = useActiveZones();
  const selections = useMySavedSelections(provider?.id as string | undefined);
  const docs = useProviderDocuments(provider?.id as string | undefined);
  const selectedServiceIds =
    selections.data?.services
      ?.map((s: { service_id: string }) => s.service_id)
      .filter((id: string) => services.data?.some((s: { id: string }) => s.id === id)) ?? [];
  const applyRequirements = useRequirementsForServices(selectedServiceIds);
  const requirementFulfillments = useMyRequirementFulfillments(provider?.id as string | undefined);
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

  const bootstrapQueries = [providerQ, snapshot, services, zones, selections, docs];
  const queries = [...bootstrapQueries, applyRequirements];
  const status = provider?.onboarding_status as string | undefined;
  const dataReady =
    !!provider && bootstrapQueries.every((q) => q.isSuccess && !q.isLoading && !q.isPending);
  const redirectHome = !!provider && !!status && status !== "DRAFT" && status !== "NEEDS_CHANGES";

  useEffect(() => {
    if (redirectHome) router.replace("/pro-setup-home");
  }, [redirectHome]);

  const bootstrapping = providerQ.isSuccess && !provider && !start.isError;
  const gateQuery = {
    ...providerQ,
    isError: providerQ.isError || start.isError,
    isPending: providerQ.isPending || providerQ.isLoading || bootstrapping || start.isPending,
    isLoading: providerQ.isLoading || providerQ.isPending || bootstrapping || start.isPending,
    refetch: () => {
      if (start.isError) {
        // Keep the latch set: the retry is started here, so the effect must not start a second one.
        started.current = true;
        start.reset();
        start.mutate();
        return Promise.resolve();
      }
      return providerQ.refetch();
    },
  };

  if (redirectHome) return null;

  const persist = async (saveStep: number, draft: ApplyDraft) => {
    const providerId = provider!.id as string;
    const savedServices = selections.data!.services;
    const serviceRows = services.data!;
    if (saveStep === 1) {
      await save.mutateAsync({ section: "personal", payload: { legal_name: draft.name } });
      if (draft.mode !== "in_person") {
        const gov = await supabase.rpc(
          "set_my_governorate" as never,
          {
            p_governorate: draft.governorate,
          } as never,
        );
        if (gov.error) throw gov.error;
      }
      const mode = await supabase.rpc("provider_update_offering_mode", {
        p_offering_mode: draft.mode,
      });
      if (mode.error) throw mode.error;
      // Online only needs no service zone; at-home work keeps the chosen zones.
      await save.mutateAsync({
        section: "coverage",
        payload: { zone_ids: draft.mode === "online" ? [] : draft.zones },
      });
      await qc.invalidateQueries({ queryKey: ["my-provider"] });
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
      mode: normalizeApplyWorkMode(provider!.offering_mode),
      governorate: typeof provider!.governorate === "string" ? provider!.governorate : "",
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
    // A returning applicant continues where they stopped, unless a link asks for a step.
    const step =
      requestedStep ??
      resumeApplyStep({
        basicsReady: applyStepReady(1, initial, serviceRows as ApplyService[]),
        servicesReady: applyStepReady(
          2,
          initial,
          servicesForMode(serviceRows as ApplyService[], initial.mode),
        ),
      });
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
        documents={docs.data ?? []}
        requirements={applyRequirements.data ?? []}
        fulfillments={requirementFulfillments.data ?? []}
        changesRequested={status === "NEEDS_CHANGES"}
        onSave={persist}
        onCapture={async (type, file) => {
          await upload.mutateAsync({ type, file });
        }}
      />
    );
  }

  return (
    <Page
      title={t("providerApply.checklist")}
      queries={queries}
      header={
        <ProviderHeader
          title={t("providerApply.checklist")}
          action={<ProviderAccountMenu />}
          hideBack={!providerHeaderShowsBack(router.canGoBack())}
        />
      }
    >
      <QueryState query={gateQuery}>{dataReady ? flow : null}</QueryState>
    </Page>
  );
}
