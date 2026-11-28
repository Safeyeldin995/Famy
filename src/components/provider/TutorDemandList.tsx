/**
 * «الطلبة بيدوروا على إيه»: unmet student demand for approved tutors (web).
 * Counts only; no student data. Each row can open the add-subject screen prefilled.
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MapPin, Monitor, Sparkles, Users } from "lucide-react";
import { useMyProvider, useMyProviderServices } from "@/lib/db/provider-queries";
import { useTeachingSubjectServices } from "@/lib/db/teaching-queries";
import { useTutorDemandInsights } from "@/lib/db/tutor-demand-queries";
import { useProPath } from "@/lib/provider/useProPath";
import { ProviderSectionHeader } from "@/components/famio/ProviderSectionHeader";
import {
  demandAction,
  demandHeadline,
  demandPrefillParams,
  demandRecency,
  demandWhat,
  isGoodFit,
  sortDemandRows,
  type TutorDemandInsightRow,
} from "@/lib/provider/tutorDemandInsights";

type ServiceStatusRow = { service_id: string; status?: string | null };

/** Tutors are approved providers that offer at least one service with teaching subjects. */
export function useIsApprovedTutor(): {
  providerId?: string;
  tutor: boolean;
  statuses: Record<string, string>;
} {
  const providerQ = useMyProvider();
  const provider = providerQ.data as { id?: string; onboarding_status?: string } | undefined;
  const servicesQ = useMyProviderServices(provider?.id);
  const linksQ = useTeachingSubjectServices();
  const rows = (servicesQ.data ?? []) as ServiceStatusRow[];
  const statuses = Object.fromEntries(rows.map((r) => [r.service_id, r.status ?? ""]));
  const teachingServiceIds = new Set((linksQ.data ?? []).map((l) => l.service_id));
  const tutor =
    provider?.onboarding_status === "APPROVED" &&
    rows.some(
      (r) =>
        teachingServiceIds.has(r.service_id) &&
        ["approved", "pending", "paused"].includes(r.status ?? ""),
    );
  return { providerId: provider?.id, tutor, statuses };
}

export function TutorDemandList({
  limit,
  showHeader = true,
}: {
  limit?: number;
  showHeader?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const proPath = useProPath();
  const { tutor, statuses } = useIsApprovedTutor();
  const q = useTutorDemandInsights(tutor);
  if (!tutor) return null;

  const rows = sortDemandRows(q.data ?? []);
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <section aria-labelledby="tutor-demand-title" data-testid="tutor-demand">
      {showHeader ? (
        <div id="tutor-demand-title">
          <ProviderSectionHeader
            title={t("tutorDemand.title")}
            action={
              limit && rows.length > limit ? (
                <Link
                  to={proPath("/pro/demand") as "/pro/demand"}
                  className="text-xs font-extrabold text-brand"
                >
                  {t("tutorDemand.seeAll")}
                </Link>
              ) : null
            }
          />
        </div>
      ) : null}
      {q.isLoading ? (
        <div
          role="status"
          aria-label={t("pro.common.loading")}
          className="h-24 animate-pulse rounded-[1.25rem] bg-surface-2"
        />
      ) : q.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-[1.25rem] border border-border p-4 text-sm"
        >
          <span className="min-w-0 flex-1 font-semibold">{t("tutorDemand.loadFailed")}</span>
          <button
            type="button"
            className="focus-ring min-h-11 rounded-xl px-3 font-extrabold text-brand"
            onClick={() => void q.refetch()}
          >
            {t("tutorDemand.retry")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-[1.25rem] border border-dashed border-border/60 p-6 text-center">
          <p className="text-sm font-bold">{t("tutorDemand.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("tutorDemand.emptyBody")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((row) => (
            <DemandRow
              key={`${row.service_id}:${row.subject_id}:${row.curriculum_id}:${row.level_id}:${row.service_mode}:${row.governorate_code}`}
              row={row}
              lang={i18n.language}
              serviceStatus={statuses[row.service_id]}
            />
          ))}
        </ul>
      )}
      {shown.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("tutorDemand.privacyNote")}</p>
      ) : null}
    </section>
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
  const proPath = useProPath();
  const action = demandAction(row, serviceStatus);
  const fit = isGoodFit(row);
  const ModeIcon = row.service_mode === "online" ? Monitor : MapPin;
  return (
    <li
      className={`rounded-[1.25rem] border p-4 ${fit ? "border-brand/40 bg-brand/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand"
          aria-hidden
        >
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-pro-14 font-extrabold leading-snug">{demandHeadline(row, lang, t)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <ModeIcon className="h-3.5 w-3.5" aria-hidden />
            <span>{demandRecency(row.last_requested_at, t)}</span>
            {fit ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-bold text-brand">
                <Sparkles className="h-3 w-3" aria-hidden />
                {t("tutorDemand.fitBadge")}
              </span>
            ) : null}
            {row.near_me ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-bold text-foreground">
                {t("tutorDemand.nearBadge")}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {action.kind === "add" ? (
          action.target === "setup" ? (
            <Link
              to={proPath("/pro/setup/$item") as "/pro/setup/$item"}
              params={{ item: "subjects" }}
              search={demandPrefillParams(action)}
              aria-label={t("tutorDemand.addAria", { what: demandWhat(row, lang) })}
              className="focus-ring inline-flex min-h-11 items-center rounded-2xl bg-brand px-4 text-pro-13 font-extrabold text-brand-foreground"
            >
              {t("tutorDemand.add")}
            </Link>
          ) : (
            <Link
              to={proPath("/pro/request-service/$serviceId") as "/pro/request-service/$serviceId"}
              params={{ serviceId: action.serviceId }}
              search={demandPrefillParams(action)}
              aria-label={t("tutorDemand.addAria", { what: demandWhat(row, lang) })}
              className="focus-ring inline-flex min-h-11 items-center rounded-2xl bg-brand px-4 text-pro-13 font-extrabold text-brand-foreground"
            >
              {t("tutorDemand.add")}
            </Link>
          )
        ) : action.kind === "pending" ? (
          <span className="text-xs font-bold text-muted-foreground">
            {t("tutorDemand.pending")}
          </span>
        ) : (
          <span className="text-xs font-bold text-muted-foreground">
            {action.needsMode
              ? t(
                  row.service_mode === "online"
                    ? "tutorDemand.needsOnline"
                    : "tutorDemand.needsHome",
                )
              : t("tutorDemand.hasIt")}
          </span>
        )}
      </div>
    </li>
  );
}
