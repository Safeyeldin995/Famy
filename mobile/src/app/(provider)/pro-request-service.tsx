import { useLocalSearchParams, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  useAllServices,
  useMyProviderServicesDetailed,
  useProviderRequestService,
  uploadRequirementEvidence,
} from "@/lib/provider/profileQueries";
import { useMyProvider } from "@/lib/provider/queries";
import { isPriceInRange } from "@shared/provider/priceOptions";
import {
  buildAgeGroupsFromChips,
  buildRequirementFulfillmentPayload,
  validateTeachingGroups,
  type TeachingGroupDraft,
} from "@shared/provider/serviceRequestPayload";
import { AGE_GROUP_CHIP_IDS } from "@shared/provider/ageGroupCapabilities";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { useRequirementsForService } from "@/lib/bookingQueries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { localized } from "@/lib/presentation";
import { Page, QueryState, ActionError, Field } from "@/ui/Page";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { ProviderPriceStepper } from "@/ui/provider/ProviderPriceStepper";
import { ServiceRequestTeachingDraft } from "@/ui/provider/ServiceRequestTeachingDraft";
import { DocumentUploadCard } from "@/ui/provider/DocumentUploadCard";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";

export default function ProRequestServiceScreen() {
  const { serviceId } = useLocalSearchParams<{ serviceId: string }>();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const providerQ = useMyProvider();
  const providerId = providerQ.data?.id as string | undefined;
  const servicesQ = useAllServices();
  const mineQ = useMyProviderServicesDetailed(providerId);
  const submit = useProviderRequestService();
  const [price, setPrice] = useState<number | null>(null);
  const [maxChildren, setMaxChildren] = useState(1);
  const [ageChips, setAgeChips] = useState<string[]>([]);
  const [teachingGroups, setTeachingGroups] = useState<TeachingGroupDraft[]>([]);
  const [error, setError] = useState(false);

  const service = useMemo(
    () => (servicesQ.data ?? []).find((row) => String(row.id) === serviceId),
    [servicesQ.data, serviceId],
  );
  const categorySlug = (service?.category as { slug?: string } | undefined)?.slug;
  const tutoring = isTutoringCategorySlug(categorySlug);
  const babysitting = categorySlug === "babysitting";
  const reqQ = useRequirementsForService(service?.id as string | undefined);
  const fulfillQ = useQuery({
    enabled: !!providerId,
    queryKey: ["my-requirement-fulfillments", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_requirement_fulfillments")
        .select("*")
        .eq("provider_id", providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const approvalRequirements = useMemo(
    () => (reqQ.data ?? []).filter((r) => r.required_for_provider_approval),
    [reqQ.data],
  );

  const submitRequest = () => {
    if (!service || !providerId) return;
    const payload: Record<string, unknown> = {};
    if (tutoring) {
      const teachingError = validateTeachingGroups(teachingGroups);
      if (teachingError) {
        setError(true);
        return;
      }
      payload.teaching_groups = teachingGroups;
    } else if (service.provider_pricing_allowed) {
      const min = service.minimum_price as number | null;
      const max = service.maximum_price as number | null;
      const value = price ?? min ?? 0;
      if (!isPriceInRange(value, min, max)) {
        setError(true);
        return;
      }
      payload.price_override = value;
    }
    if (babysitting) {
      if (maxChildren < 1 || maxChildren > 6) {
        setError(true);
        return;
      }
      payload.max_children_per_booking = maxChildren;
      if (ageChips.length > 0) {
        payload.age_group_capabilities = buildAgeGroupsFromChips(ageChips, {}, {});
      }
    }
    const fulfillmentPayload = buildRequirementFulfillmentPayload(
      approvalRequirements.map((r) => r.id),
      fulfillQ.data ?? [],
    );
    for (const req of approvalRequirements) {
      const row = fulfillmentPayload.find((f) => f.requirement_id === req.id);
      if (req.evidence_required && !row?.evidence_storage_path) {
        setError(true);
        return;
      }
    }
    if (fulfillmentPayload.length) payload.requirement_fulfillments = fulfillmentPayload;

    setError(false);
    submit.mutate(
      {
        serviceId: String(service.id),
        payload,
        idempotencyKey: crypto.randomUUID(),
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <Page
      title={t("pro.serviceRequest.pageTitle")}
      header={<ProviderHeader title={t("pro.serviceRequest.pageTitle")} />}
      queries={[providerQ, servicesQ]}
      contentStyle={{ gap: space.lg }}
    >
      <QueryState query={providerQ}>
        {providerQ.data?.onboarding_status !== "APPROVED" ? (
          <Text>{t("pro.serviceRequest.notApproved")}</Text>
        ) : !service ? (
          <Text>{t("pro.serviceRequest.serviceUnavailable")}</Text>
        ) : (
          <>
            <Text weight="bold">{localized(service, i18n.language)}</Text>
            <Text tone="muted">
              {t("pro.serviceRequest.intro", { service: localized(service, i18n.language) })}
            </Text>
            {tutoring && providerId ? (
              <ServiceRequestTeachingDraft
                service={service as Parameters<typeof ServiceRequestTeachingDraft>[0]["service"]}
                groups={teachingGroups}
                onChangeGroups={setTeachingGroups}
              />
            ) : null}
            {!tutoring && service.provider_pricing_allowed ? (
              <ProviderPriceStepper
                min={service.minimum_price as number | null}
                max={service.maximum_price as number | null}
                value={price ?? (service.minimum_price as number | null) ?? 0}
                onChange={setPrice}
              />
            ) : null}
            {babysitting ? (
              <View style={{ gap: space.md }}>
                <Field
                  label={t("pro.serviceRequest.maxChildren")}
                  value={String(maxChildren)}
                  keyboardType="number-pad"
                  onChangeText={(value) => setMaxChildren(Number(value) || 1)}
                />
                <Text weight="bold">{t("pro.serviceRequest.babysittingTitle")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {AGE_GROUP_CHIP_IDS.map((chip) => {
                    const on = ageChips.includes(chip);
                    return (
                      <Button
                        key={chip}
                        variant={on ? "primary" : "secondary"}
                        label={t(`pro.onboardingWizard.ageGroups.${chip}`)}
                        onPress={() =>
                          setAgeChips((ids) =>
                            on ? ids.filter((id) => id !== chip) : [...ids, chip],
                          )
                        }
                      />
                    );
                  })}
                </View>
              </View>
            ) : null}
            {approvalRequirements.length > 0 && providerId ? (
              <View style={{ gap: space.md }}>
                <Text weight="bold">{t("providerProfilePolish.requirements")}</Text>
                {approvalRequirements.map((req) => {
                  const mine = (fulfillQ.data ?? []).find((f) => f.requirement_id === req.id);
                  return (
                    <DocumentUploadCard
                      key={req.id}
                      title={i18n.language.startsWith("ar") ? req.name_ar : req.name_en}
                      statusLabel={
                        mine?.evidence_storage_path
                          ? t("pro.serviceRequest.evidenceUploaded")
                          : t("pro.profile.uploadEvidence")
                      }
                      captured={!!mine?.evidence_storage_path}
                      onPick={async (file) => {
                        await uploadRequirementEvidence(providerId, req.id, file);
                        await qc.invalidateQueries({
                          queryKey: ["my-requirement-fulfillments", providerId],
                        });
                      }}
                    />
                  );
                })}
              </View>
            ) : null}
            <Button
              label={t("pro.serviceRequest.submit")}
              loading={submit.isPending}
              onPress={submitRequest}
            />
          </>
        )}
      </QueryState>
      <ActionError error={error || submit.isError} />
      <QueryState query={mineQ} />
    </Page>
  );
}
