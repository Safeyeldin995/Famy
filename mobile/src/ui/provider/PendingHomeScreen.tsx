import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { missingTeachingServices } from "@/lib/provider/teachingSetup";
import { workingHoursState } from "@shared/provider/setupHelpers";
import { pendingHomeModel } from "@shared/provider/pendingHomeModel";
import {
  useOnboardingSnapshot,
  useMyReferences,
  useMySavedSelections,
  usePhase1Services,
  useSubmitOnboarding,
} from "@/lib/provider/onboardingQueries";
import { useMyTeachingCapabilities } from "@/lib/provider/teachingQueries";
import { useMyProvider, useProviderAvailability } from "@/lib/provider/queries";
import { Page, QueryState, Row } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { proCard } from "./cards";
import { space } from "@/ui/theme";

export function PendingHomeScreen({ changesRequested }: { changesRequested?: boolean }) {
  const { t, i18n } = useTranslation();
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
  const queries = [p, snapshot, refs, selections, services, subjects, availability];
  const ready = !!provider && queries.every((q) => q.isSuccess && !q.isLoading && !q.isPending);

  let body = null;
  if (ready) {
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
      subjects: selectedFiltered
        .filter((s) => s.category?.slug === "tutoring")
        .every((s) =>
          (subjects.data ?? []).some(
            (row: { service_id: string; status: string }) =>
              row.service_id === s.id && row.status !== "rejected",
          ),
        ),
    };
    const model = pendingHomeModel(pendingData);
    const firstName = (data.profile?.full_name || t("pro.common.customer")).trim().split(/\s+/)[0];
    body = (
      <View style={{ gap: space.lg }}>
        <Text size="title" weight="heavy">
          {t("providerApply.pending.hello", { name: firstName })}
        </Text>
        {provider?.review_reason_public ? (
          <View style={proCard.card}>
            <Text weight="bold">{t("providerChanges.title")}</Text>
            <Text>{String(provider.review_reason_public)}</Text>
          </View>
        ) : null}
        <Text tone="muted">
          {t(model.remaining ? model.subtitleKey : "providerApply.pending.reviewingHint")}
        </Text>
        {model.items.map(({ key }) => (
          <Row
            key={key}
            label={t(key === "hours" ? "providerSetup.titles.hours" : `providerApply.${key}`)}
            detail={t(`providerApply.pending.items.${key}`)}
            onPress={() =>
              router.push({
                pathname: "/pro-setup/[item]",
                params: { item: key },
              })
            }
          />
        ))}
        <Row label={t("providerDocuments.title")} onPress={() => router.push("/pro-documents")} />
        {changesRequested ? (
          <Button
            label={t("providerChanges.resubmit")}
            loading={submit.isPending}
            onPress={() => void submit.mutateAsync()}
          />
        ) : null}
      </View>
    );
  }

  return (
    <Page title={t("providerApply.checklist")} queries={queries}>
      <QueryState query={p}>{ready ? body : null}</QueryState>
    </Page>
  );
}
