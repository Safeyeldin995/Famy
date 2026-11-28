import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import { missingTeachingServices } from "@/lib/provider/teachingSetup";
import { workingHoursState } from "@shared/provider/setupHelpers";
import { pendingHomeModel } from "@shared/provider/pendingHomeModel";
import { useMyCredentials } from "@/lib/provider/credentialQueries";
import { ProfileCompletionCard } from "./ProfileCompletionCard";
import {
  providerOnboardingTerminal,
  providerStatusBodyKey,
  providerStatusTitleKey,
} from "@/lib/provider/gates";
import { onboardingMutationErrorMessage } from "@/lib/provider/onboardingErrors";
import { providerHeaderShowsBack } from "@/lib/provider/providerHeaderBack";
import {
  useOnboardingSnapshot,
  useMyReferences,
  useMySavedSelections,
  usePhase1Services,
  useSubmitOnboarding,
} from "@/lib/provider/onboardingQueries";
import { useMyTeachingCapabilities } from "@/lib/provider/teachingQueries";
import { useMyProvider, useProviderAvailability } from "@/lib/provider/queries";
import { useProviderReviewSlaHours } from "@/lib/provider/journeyQueries";
import { Page, QueryState } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { proCard } from "./cards";
import { ProviderAccountMenu } from "./ProviderAccountMenu";
import { ProviderHeader } from "./ProviderHeader";
import { colors, space } from "@/ui/theme";

type QuerySlice = {
  isPending?: boolean;
  isLoading?: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => unknown;
};

function combineQueries(queries: QuerySlice[]) {
  return {
    isError: queries.some((q) => q.isError),
    isLoading: queries.some((q) => q.isLoading ?? q.isPending),
    isPending: queries.some((q) => q.isPending ?? q.isLoading),
    isSuccess: queries.every((q) => q.isSuccess),
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

export function PendingHomeScreen({
  changesRequested,
  onboardingStatus,
}: {
  changesRequested?: boolean;
  onboardingStatus?: string;
}) {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as Record<string, unknown> | null | undefined;
  const providerId = provider?.id as string | undefined;
  const snapshot = useOnboardingSnapshot();
  const refs = useMyReferences(providerId);
  const selections = useMySavedSelections(providerId);
  const services = usePhase1Services();
  const subjects = useMyTeachingCapabilities(providerId);
  const availability = useProviderAvailability(providerId);
  const submit = useSubmitOnboarding();
  const slaQ = useProviderReviewSlaHours();
  const credentials = useMyCredentials(providerId);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queries = [p, snapshot, refs, selections, services, subjects, availability, credentials];
  const gateQuery = combineQueries(queries as QuerySlice[]);
  const ready = !!provider && gateQuery.isSuccess && !gateQuery.isLoading && !gateQuery.isPending;
  const terminal = providerOnboardingTerminal(onboardingStatus);

  let body = null;
  if (ready) {
    if (terminal) {
      body = (
        <View style={{ gap: space.lg }}>
          <View style={proCard.card}>
            <Text size="title" weight="heavy">
              {t(providerStatusTitleKey(true, onboardingStatus))}
            </Text>
            <Text tone="muted">{t(providerStatusBodyKey(true, onboardingStatus))}</Text>
            {provider?.review_reason_public ? (
              <Text style={{ marginTop: space.sm }}>{String(provider.review_reason_public)}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("profile.help")}
            onPress={() => router.push("/pro-help")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text weight="bold" tone="brand">
              {t("profile.help")}
            </Text>
          </Pressable>
        </View>
      );
    } else {
      const data = snapshot.data as {
        profile?: { avatar_url?: string; full_name?: string };
        provider?: { bio_en?: string; bio_ar?: string; max_children_per_booking?: number };
        details?: {
          date_of_birth?: string;
          governorate?: string;
          area?: string;
          full_address?: string;
        };
        age_group_capabilities?: unknown[];
      };
      const selected = (services.data ?? []) as {
        id: string;
        category?: { slug?: string };
        name_ar: string;
        name_en: string;
      }[];
      const selectedFiltered = selected.filter((s) =>
        (selections.data?.services ?? []).some(
          (row: { service_id: string }) => row.service_id === s.id,
        ),
      );
      const hours = workingHoursState(availability.data ?? [], selectedFiltered as never);
      const pendingData = {
        hours: hours.done,
        photo: !!data.profile?.avatar_url,
        about: !!(data.provider?.bio_en || data.provider?.bio_ar),
        personal: !!(
          data.details?.date_of_birth &&
          data.details.governorate &&
          data.details.area &&
          data.details.full_address
        ),
        reference: (refs.data ?? []).length > 0,
        needsBabysitting: selectedFiltered.some((s) => s.category?.slug === "babysitting"),
        babysitting:
          !!data.provider?.max_children_per_booking && !!(data.age_group_capabilities ?? []).length,
        missingSubjects: missingTeachingServices(
          selectedFiltered.filter((s) => s.category?.slug === "tutoring"),
          subjects.data ?? [],
        ),
        needsSubjects: selectedFiltered.some((s) => s.category?.slug === "tutoring"),
        subjects:
          missingTeachingServices(
            selectedFiltered.filter((s) => s.category?.slug === "tutoring"),
            subjects.data ?? [],
          ).length === 0,
      };
      const model = pendingHomeModel(pendingData);
      const completionData = {
        ...pendingData,
        educationCount: credentials.data?.education.length ?? 0,
        experienceCount: credentials.data?.experience.length ?? 0,
        certificateCount: credentials.data?.certificates.length ?? 0,
      };
      const firstName = (
        data.profile?.full_name?.trim().split(/\s+/)[0] || t("pro.common.greetingFallback")
      ).trim();
      const awaitingReview =
        onboardingStatus === "SUBMITTED" ||
        onboardingStatus === "UNDER_REVIEW" ||
        (!onboardingStatus && !changesRequested);
      body = (
        <View style={{ gap: space.lg }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Text size="title" weight="heavy">
              {t("providerApply.pending.hello", { name: firstName })}
            </Text>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.brandTint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text weight="heavy" tone="brand">
                {firstName.slice(0, 1)}
              </Text>
            </View>
          </View>
          {provider?.review_reason_public ? (
            <View style={proCard.card}>
              <Text weight="bold">{t("providerChanges.title")}</Text>
              <Text>{String(provider.review_reason_public)}</Text>
            </View>
          ) : null}
          {awaitingReview ? (
            <View
              style={[proCard.card, { flexDirection: "row", alignItems: "center", gap: space.md }]}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: colors.warningTint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ShieldCheck size={20} color={colors.warning} />
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text weight="bold" size="sm">
                  {t("providerApply.pending.review")}
                </Text>
                <Text tone="muted" size="xs">
                  {model.remaining
                    ? t(model.titleKey, { remaining: model.remaining })
                    : t("providerApply.pending.reviewSla", { hours: slaQ.data ?? 24 })}
                </Text>
              </View>
            </View>
          ) : null}
          {model.remaining === 0 ? (
            <View style={[proCard.card, { backgroundColor: colors.successTint }]}>
              <Text weight="heavy" tone="success">
                {t("providerComplete.title")}
              </Text>
              <Text tone="success">{t("providerComplete.message")}</Text>
            </View>
          ) : null}
          <ProfileCompletionCard data={completionData} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("providerDocuments.title")}
            onPress={() => router.push("/pro-documents")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text weight="bold" tone="brand">
              {t("providerDocuments.title")}
            </Text>
          </Pressable>
          {changesRequested ? (
            <>
              {submitError ? (
                <Text tone="danger" accessibilityLiveRegion="polite">
                  {submitError}
                </Text>
              ) : null}
              <Button
                label={t("providerChanges.resubmit")}
                loading={submit.isPending}
                onPress={() => {
                  setSubmitError(null);
                  submit.mutate(undefined, {
                    onError: (e) => setSubmitError(onboardingMutationErrorMessage(t, e)),
                  });
                }}
              />
            </>
          ) : null}
        </View>
      );
    }
  }

  return (
    <Page
      title={t("providerApply.checklist")}
      header={
        <ProviderHeader
          title={t("providerApply.checklist")}
          action={<ProviderAccountMenu />}
          hideBack={!providerHeaderShowsBack(router.canGoBack())}
        />
      }
      queries={queries}
      contentStyle={{ paddingTop: space.sm }}
    >
      <QueryState query={gateQuery}>{ready ? body : null}</QueryState>
    </Page>
  );
}
