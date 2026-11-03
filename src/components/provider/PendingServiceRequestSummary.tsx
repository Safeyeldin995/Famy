import {
  useMyRequirementFulfillments,
  useRequirementsForService,
} from "@/lib/db/provider-queries";
import {
  useMyTeachingCapabilities,
  useTeachingCurricula,
  useTeachingLevels,
  useTeachingSubjects,
} from "@/lib/db/teaching-queries";
import { localizedTaxonomyName } from "@/lib/tutoring/teachingCapabilities";
import { groupTeachingRows } from "@/lib/tutoring/teachingGroups";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const lang = i18n.language === "ar" ? "ar" : "en";
  const teachingQ = useMyTeachingCapabilities(providerId);
  const subjectsQ = useTeachingSubjects();
  const curriculaQ = useTeachingCurricula();
  const levelsQ = useTeachingLevels();
  const reqQ = useRequirementsForService(serviceId);
  const mineQ = useMyRequirementFulfillments(providerId);
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

  const pendingRows = useMemo(
    () =>
      (teachingQ.data ?? []).filter(
        (row) => row.service_id === serviceId && row.status === "pending",
      ),
    [teachingQ.data, serviceId],
  );

  const groups = useMemo(() => groupTeachingRows(pendingRows), [pendingRows]);
  const approvalReqs = (reqQ.data ?? []).filter((r) => r.required_for_provider_approval);
  const fulfillments = mineQ.data ?? [];

  if (categorySlug === "tutoring" && groups.length === 0 && teachingQ.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("pro.common.loading")}</p>;
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-border/60 bg-surface-2/40 p-3 text-xs">
      <p className="font-bold text-foreground">{t("pro.serviceRequest.submittedSummaryTitle")}</p>
      {categorySlug === "tutoring" &&
        groups.map((group) => {
          const first = group.first;
          const subject = subjectsQ.data?.find((s) => s.id === first.subject_id);
          const curriculum = curriculaQ.data?.find((c) => c.id === first.curriculum_id);
          const levelNames = group.rows
            .map((row) => levelsQ.data?.find((l) => l.id === row.level_id))
            .filter(Boolean)
            .map((level) => localizedTaxonomyName(level!, lang));
          return (
            <p key={group.key} className="text-muted-foreground">
              {subject ? localizedTaxonomyName(subject, lang) : ""} ·{" "}
              {curriculum ? localizedTaxonomyName(curriculum, lang) : ""} ·{" "}
              {levelNames.join(", ")} · {first.session_duration_min} {t("scheduleUi.minutes")} ·{" "}
              {first.session_price} {t("pricePicker.sessionUnit")}
            </p>
          );
        })}
      {categorySlug !== "tutoring" && priceOverride != null && (
        <p className="text-muted-foreground">
          {t("pro.serviceRequest.summaryPrice", { price: priceOverride })}
        </p>
      )}
      {categorySlug === "babysitting" && (
        <>
          {maxChildren != null && (
            <p className="text-muted-foreground">
              {t("pro.serviceRequest.summaryMaxChildren", { count: maxChildren })}
            </p>
          )}
          {(ageQ.data ?? []).length > 0 && (
            <p className="text-muted-foreground">
              {t("pro.serviceRequest.summaryAgeGroups", {
                codes: (ageQ.data ?? []).map((r) => r.age_group_code).join(", "),
              })}
            </p>
          )}
        </>
      )}
      {approvalReqs.length > 0 && (
        <ul className="space-y-1">
          {approvalReqs.map((req) => {
            const mine = fulfillments.find((f) => f.requirement_id === req.id);
            const label = lang === "ar" ? req.name_ar : req.name_en;
            return (
              <li key={req.id} className="text-muted-foreground">
                {label}
                {mine?.evidence_storage_path
                  ? ` · ${t("pro.serviceRequest.evidenceUploaded")}`
                  : mine?.notes
                    ? ` · ${mine.notes}`
                    : ""}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
