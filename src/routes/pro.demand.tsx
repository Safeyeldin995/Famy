import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { TutorDemandList, useIsApprovedTutor } from "@/components/provider/TutorDemandList";
import { useProPath } from "@/lib/provider/useProPath";

export const Route = createFileRoute("/pro/demand")({ component: ProDemandPage });

function ProDemandPage() {
  const { t } = useTranslation();
  const proPath = useProPath();
  const { tutor } = useIsApprovedTutor();
  return (
    <ProviderShell>
      <PageHeader
        title={t("tutorDemand.title")}
        subtitle={t("tutorDemand.subtitle")}
        backTo={proPath("/pro")}
      />
      <div className="space-y-3 px-5 pb-8">
        {tutor ? (
          <TutorDemandList showHeader={false} />
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-border/60 p-6 text-center">
            <p className="text-sm font-bold">{t("tutorDemand.empty")}</p>
            <Link
              to={proPath("/pro") as "/pro"}
              className="mt-3 inline-flex min-h-11 items-center font-extrabold text-brand"
            >
              {t("common.back")}
            </Link>
          </div>
        )}
      </div>
    </ProviderShell>
  );
}
