import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { groupTeachingRows } from "@shared/tutoring/teachingGroups";
import {
  useMyTeachingCapabilities,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
} from "@/lib/provider/teachingQueries";
import { useRequirementsForService } from "@/lib/bookingQueries";
import { supabase } from "@/lib/supabase";
import { Text } from "@/ui/Text";
import { space } from "@/ui/theme";
import { proCard } from "./cards";

export function PendingServiceRequestSummary({
  providerId,
  serviceId,
  categorySlug,
  priceOverride,
  maxChildren,
}: {
  providerId: string;
  serviceId: string;
  categorySlug?: string | null;
  priceOverride?: number | null;
  maxChildren?: number | null;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const teachingQ = useMyTeachingCapabilities(providerId);
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const reqQ = useRequirementsForService(serviceId);
  const fulfillQ = useQuery({
    queryKey: ["my-requirement-fulfillments", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_requirement_fulfillments")
        .select("*")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data ?? [];
    },
  });
  const ageQ = useQuery({
    queryKey: ["my-age-group-capabilities", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_age_group_capabilities")
        .select("age_group_code")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pendingRows = (teachingQ.data ?? []).filter(
    (row) => row.service_id === serviceId && row.status === "pending",
  );
  const groups = groupTeachingRows(pendingRows);
  const name = (row?: { name_ar: string; name_en: string }) =>
    row ? (ar ? row.name_ar : row.name_en) : "";

  return (
    <View style={[proCard.card, { gap: space.sm, marginTop: space.sm }]}>
      <Text weight="bold" size="sm">
        {t("pro.serviceRequest.submittedSummaryTitle")}
      </Text>
      {categorySlug === "tutoring" &&
        groups.map((group) => {
          const first = group.first;
          const subject = subjectsQ.data?.find((s) => s.id === first.subject_id);
          const curriculum = curriculaQ.data?.find((c) => c.id === first.curriculum_id);
          const levelNames = group.rows
            .map((row) => levelsQ.data?.find((l) => l.id === row.level_id))
            .map((level) => name(level))
            .filter(Boolean)
            .join(", ");
          return (
            <Text key={group.key} tone="muted" size="sm">
              {name(subject)} · {name(curriculum)} · {levelNames} · {first.session_duration_min}{" "}
              {t("scheduleUi.minutes")} · {first.session_price} {t("pricePicker.sessionUnit")}
            </Text>
          );
        })}
      {categorySlug !== "tutoring" && priceOverride != null && (
        <Text tone="muted" size="sm">
          {t("pro.serviceRequest.summaryPrice", { price: priceOverride })}
        </Text>
      )}
      {categorySlug === "babysitting" && maxChildren != null && (
        <Text tone="muted" size="sm">
          {t("pro.serviceRequest.summaryMaxChildren", { count: maxChildren })}
        </Text>
      )}
      {categorySlug === "babysitting" && (ageQ.data ?? []).length > 0 && (
        <Text tone="muted" size="sm">
          {t("pro.serviceRequest.summaryAgeGroups", {
            codes: (ageQ.data ?? []).map((r) => r.age_group_code).join(", "),
          })}
        </Text>
      )}
      {(reqQ.data ?? [])
        .filter((r) => r.required_for_provider_approval)
        .map((req) => {
          const mine = (fulfillQ.data ?? []).find((f) => f.requirement_id === req.id);
          return (
            <Text key={req.id} tone="muted" size="sm">
              {ar ? req.name_ar : req.name_en}
              {mine?.evidence_storage_path ? ` · ${t("pro.serviceRequest.evidenceUploaded")}` : ""}
            </Text>
          );
        })}
    </View>
  );
}
