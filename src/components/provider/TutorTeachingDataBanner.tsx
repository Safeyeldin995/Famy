/**
 * «كمل المواد والمناهج والسنين اللي بتدرسها عشان الطلبة يلاقوك» (issue #536 PR 2).
 * Shown to a tutor whose approved tutoring service has no approved subject / system / grade,
 * because strict matching hides them from students.
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { useProPath } from "@/lib/provider/useProPath";
import { useMyProvider, useMyProviderServices } from "@/lib/db/provider-queries";
import { useMyTeachingCapabilities } from "@/lib/db/teaching-queries";
import { isTutoringCategorySlug } from "@/lib/tutoring/teachingCapabilities";
import { tutorMissingTeachingData } from "@/lib/tutoring/studentLearnerFlow";

export function useTutorMissingTeachingData(): boolean {
  const providerQ = useMyProvider();
  const providerId = providerQ.data?.id;
  const servicesQ = useMyProviderServices(providerId);
  const capsQ = useMyTeachingCapabilities(providerId);
  if (!providerId || !servicesQ.data || !capsQ.data) return false;
  const approvedTutoringServiceIds = servicesQ.data
    .filter(
      (row: {
        status?: string | null;
        service?: { category?: { slug?: string | null } | null } | null;
      }) => row.status === "approved" && isTutoringCategorySlug(row.service?.category?.slug),
    )
    .map((row: { service_id: string }) => row.service_id);
  const approvedCapabilityServiceIds = capsQ.data
    .filter((c) => c.status === "approved")
    .map((c) => c.service_id);
  return tutorMissingTeachingData({ approvedTutoringServiceIds, approvedCapabilityServiceIds });
}

export function TutorTeachingDataBanner() {
  const { t } = useTranslation();
  const missing = useTutorMissingTeachingData();
  const proPath = useProPath();
  if (!missing) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-3xl border border-brand/30 bg-brand/5 p-4"
      role="status"
    >
      <GraduationCap className="h-6 w-6 shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 flex-1 text-pro-14 font-bold">{t("studentMatch.tutorBanner.title")}</p>
      <Link
        to={proPath("/pro/setup/$item") as "/pro/setup/$item"}
        params={{ item: "subjects" }}
        className="focus-ring inline-flex min-h-11 items-center rounded-2xl bg-brand px-4 text-pro-13 font-extrabold text-brand-foreground"
      >
        {t("studentMatch.tutorBanner.action")}
      </Link>
    </div>
  );
}
