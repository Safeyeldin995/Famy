// «الطلبة بيدوروا على إيه»: unmet student demand for approved tutors (app).
// Counts only, no student data. Each row opens the add-subject screen prefilled.
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { MapPin, Monitor, Sparkles, Users } from "lucide-react-native";
import { useMyProvider } from "@/lib/provider/queries";
import { useMyProviderServicesDetailed } from "@/lib/provider/profileQueries";
import { useTeachingSubjectServices } from "@/lib/provider/teachingQueries";
import { useTutorDemandInsights } from "@/lib/provider/tutorDemandQueries";
import {
  demandAction,
  demandHeadline,
  demandPrefillParams,
  demandRecency,
  demandWhat,
  isGoodFit,
  sortDemandRows,
  type TutorDemandInsightRow,
} from "@shared/provider/tutorDemandInsights";
import { Text } from "../Text";
import { Button } from "../Button";
import { colors, radius, space } from "../theme";

export function useApprovedTutor() {
  const providerQ = useMyProvider();
  const provider = providerQ.data as { id?: string; onboarding_status?: string } | null | undefined;
  const servicesQ = useMyProviderServicesDetailed(provider?.id);
  const linksQ = useTeachingSubjectServices();
  const rows = (servicesQ.data ?? []) as { service_id: string; status?: string | null }[];
  const statuses: Record<string, string> = Object.fromEntries(
    rows.map((r) => [r.service_id, r.status ?? ""]),
  );
  const teaching = new Set(
    ((linksQ.data ?? []) as { service_id: string }[]).map((l) => l.service_id),
  );
  const tutor =
    provider?.onboarding_status === "APPROVED" &&
    rows.some(
      (r) =>
        teaching.has(r.service_id) && ["approved", "pending", "paused"].includes(r.status ?? ""),
    );
  return { tutor, statuses };
}

export function TutorDemandCard({
  limit,
  showTitle = true,
}: {
  limit?: number;
  showTitle?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { tutor, statuses } = useApprovedTutor();
  const q = useTutorDemandInsights(tutor);
  if (!tutor) return null;
  const rows = sortDemandRows(q.data ?? []);
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <View style={{ gap: space.sm }} testID="tutor-demand">
      {showTitle ? (
        <View
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text weight="heavy" accessibilityRole="header">
            {t("tutorDemand.title")}
          </Text>
          {limit && rows.length > limit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("tutorDemand.seeAll")}
              onPress={() => router.push("/pro-demand")}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text tone="brand" weight="heavy" size="sm">
                {t("tutorDemand.seeAll")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {q.isLoading ? (
        <Text tone="muted" accessibilityRole="progressbar">
          {t("common.loading")}
        </Text>
      ) : q.isError ? (
        <View
          accessibilityRole="alert"
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text weight="bold">{t("tutorDemand.loadFailed")}</Text>
          <Button
            variant="secondary"
            label={t("tutorDemand.retry")}
            onPress={() => void q.refetch()}
          />
        </View>
      ) : shown.length === 0 ? (
        <View
          style={{
            gap: space.xs,
            padding: space.md,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: colors.border,
          }}
        >
          <Text weight="bold" style={{ textAlign: "center" }}>
            {t("tutorDemand.empty")}
          </Text>
          <Text tone="muted" size="sm" style={{ textAlign: "center" }}>
            {t("tutorDemand.emptyBody")}
          </Text>
        </View>
      ) : (
        <>
          {shown.map((row) => (
            <DemandRow
              key={`${row.service_id}:${row.subject_id}:${row.curriculum_id}:${row.level_id}:${row.service_mode}:${row.governorate_code}`}
              row={row}
              lang={i18n.language}
              serviceStatus={statuses[row.service_id]}
            />
          ))}
          <Text tone="muted" size="xs">
            {t("tutorDemand.privacyNote")}
          </Text>
        </>
      )}
    </View>
  );
}

function DemandRow({
  row,
  lang,
  serviceStatus,
}: {
  row: TutorDemandInsightRow;
  lang: string;
  serviceStatus: string | undefined;
}) {
  const { t } = useTranslation();
  const action = demandAction(row, serviceStatus);
  const fit = isGoodFit(row);
  const ModeIcon = row.service_mode === "online" ? Monitor : MapPin;
  const open = () => {
    if (action.kind !== "add") return;
    const params = demandPrefillParams(action);
    if (action.target === "setup") {
      router.push({ pathname: "/pro-setup/[item]", params: { item: "subjects", ...params } });
    } else {
      router.push({
        pathname: "/pro-request-service",
        params: { serviceId: action.serviceId, ...params },
      });
    }
  };
  return (
    <View
      style={{
        gap: space.sm,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: fit ? colors.brand : colors.border,
        backgroundColor: fit ? colors.brandTint : colors.surface,
      }}
    >
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}>
        <Users size={22} color={colors.brand} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text weight="heavy">{demandHeadline(row, lang, t)}</Text>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}
          >
            <ModeIcon size={14} color={colors.muted} />
            <Text tone="muted" size="xs">
              {demandRecency(row.last_requested_at, t)}
            </Text>
            {fit ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Sparkles size={12} color={colors.brand} />
                <Text tone="brand" size="xs" weight="bold">
                  {t("tutorDemand.fitBadge")}
                </Text>
              </View>
            ) : null}
            {row.near_me ? (
              <Text size="xs" weight="bold">
                {t("tutorDemand.nearBadge")}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      {action.kind === "add" ? (
        <Button
          label={t("tutorDemand.add")}
          accessibilityLabel={t("tutorDemand.addAria", { what: demandWhat(row, lang) })}
          onPress={open}
        />
      ) : (
        <Text tone="muted" size="sm" weight="bold">
          {action.kind === "pending"
            ? t("tutorDemand.pending")
            : action.needsMode
              ? t(
                  row.service_mode === "online"
                    ? "tutorDemand.needsOnline"
                    : "tutorDemand.needsHome",
                )
              : t("tutorDemand.hasIt")}
        </Text>
      )}
    </View>
  );
}
