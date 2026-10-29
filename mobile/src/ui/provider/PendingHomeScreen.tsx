import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Baby,
  BookOpen,
  Check,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react-native";
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
import { Page, QueryState } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { proCard } from "./cards";
import { colors, radius, space } from "@/ui/theme";

const icons = {
  photo: User,
  about: MessageSquare,
  babysitting: Baby,
  subjects: BookOpen,
  reference: Phone,
  personal: MapPin,
  hours: Clock,
};

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
      subjects:
        missingTeachingServices(
          selectedFiltered.filter((s) => s.category?.slug === "tutoring"),
          subjects.data ?? [],
        ).length === 0,
    };
    const model = pendingHomeModel(pendingData);
    const firstName = (data.profile?.full_name || t("pro.common.customer")).trim().split(/\s+/)[0];
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
        {model.remaining ? (
          <View
            style={{
              minHeight: 100,
              borderRadius: radius.xl,
              backgroundColor: colors.foreground,
              flexDirection: "row",
              alignItems: "center",
              padding: 20,
              gap: 16,
            }}
          >
            <View
              style={{
                width: 58,
                height: 58,
                borderRadius: 29,
                borderWidth: 6,
                borderColor: colors.brand,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                weight="heavy"
                style={{ color: colors.brandForeground, writingDirection: "ltr" }}
              >
                {model.done}/{model.total}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text weight="heavy" style={{ color: colors.brandForeground }}>
                {t(model.titleKey, { remaining: model.remaining })}
              </Text>
              <Text size="xs" style={{ color: colors.brandForeground }}>
                {t(model.subtitleKey)}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[proCard.card, { backgroundColor: "#E7F7EF" }]}>
            <Text weight="heavy" tone="success">
              {t("providerComplete.title")}
            </Text>
            <Text tone="success">{t("providerComplete.message")}</Text>
          </View>
        )}
        <View style={{ gap: 0 }}>
          {model.items.map(({ key, done, next }) => {
            const Icon = icons[key];
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={t(
                  key === "hours" ? "providerSetup.titles.hours" : `providerApply.${key}`,
                )}
                onPress={() =>
                  router.push({ pathname: "/pro-setup/[item]", params: { item: key } })
                }
                style={{
                  minHeight: 68,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: done ? "#E7F7EF" : colors.surface2,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={20} color={done ? colors.success : colors.muted} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text weight="bold" size="sm">
                    {t(key === "hours" ? "providerSetup.titles.hours" : `providerApply.${key}`)}
                  </Text>
                  <Text tone="muted" size="xs">
                    {key === "subjects" && pendingData.missingSubjects.length
                      ? t("providerClarity.missingSubjects", {
                          services: pendingData.missingSubjects
                            .map((service) =>
                              i18n.language.startsWith("ar") ? service.name_ar : service.name_en,
                            )
                            .join(i18n.language.startsWith("ar") ? "، " : ", "),
                        })
                      : t(
                          key === "hours"
                            ? "providerSetup.hoursHint"
                            : `providerApply.pending.items.${key}`,
                        )}
                  </Text>
                </View>
                {done ? (
                  <Check size={18} color={colors.success} />
                ) : (
                  <Text weight="bold" size="xs" tone={next ? "brand" : "muted"}>
                    {t(`providerApply.pending.${next ? "start" : "minute"}`)}
                  </Text>
                )}
              </Pressable>
            );
          })}
          <View style={{ minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: "#FFF5DF",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShieldCheck size={20} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="bold" size="sm">
                {t("providerApply.pending.review")}
              </Text>
              <Text tone="muted" size="xs">
                {t("providerComplete.message")}
              </Text>
            </View>
            <Text size="xs" tone="muted">
              {t("providerApply.pending.waiting")}
            </Text>
          </View>
        </View>
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
    <Page
      title={t("providerApply.checklist")}
      header={<View />}
      queries={queries}
      contentStyle={{ paddingTop: 8 }}
    >
      <QueryState query={p}>{ready ? body : null}</QueryState>
    </Page>
  );
}
