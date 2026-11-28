import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Pencil } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";
import { useLessonReport } from "@/lib/db/lesson-report-queries";
import { LessonReportForm } from "./LessonReportForm";
import { LessonReportView } from "./LessonReportView";

const DONE_STATUSES = new Set(["completed", "completion_requested"]);

/**
 * The lesson report block on a booking page. Hidden for non-teaching bookings and
 * before the lesson. The tutor writes or edits it; the family reads it.
 */
export function LessonReportSection({
  bookingId,
  bookingStatus,
  tutorName,
  progressHref,
}: {
  bookingId: string;
  bookingStatus: string;
  tutorName?: string | null;
  /** Where «تقدم {name}» opens on this surface; omitted on surfaces without a progress page. */
  progressHref?: (learnerId: string, isChild: boolean) => string | null;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const enabled = DONE_STATUSES.has(bookingStatus);
  const q = useLessonReport(bookingId, enabled);
  if (!enabled) return null;
  if (q.isLoading) {
    return (
      <section className="rounded-2xl border border-border/60 bg-white p-4" aria-busy="true">
        <p className="text-pro-13 text-muted-foreground">{t("common.loading")}</p>
      </section>
    );
  }
  if (q.isError) {
    return (
      <section className="space-y-2 rounded-2xl border border-border/60 bg-white p-4">
        <p className="text-pro-13 text-coral">{t("lessonReport.loadError")}</p>
        <button
          type="button"
          className="text-pro-13 font-bold text-brand underline"
          onClick={() => void q.refetch()}
        >
          {t("common.tryAgain")}
        </button>
      </section>
    );
  }
  const ctx = q.data;
  if (!ctx?.eligible || !ctx.kind) return null;
  const isTutor = ctx.viewer_role === "provider";
  const showForm = isTutor && ctx.can_write && (!ctx.report || editing);
  const href = !isTutor && progressHref ? progressHref(ctx.learner_id, ctx.learner_is_child) : null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
      aria-labelledby={`lesson-report-${bookingId}`}
      data-testid="lesson-report-section"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={`lesson-report-${bookingId}`}
          className="flex items-center gap-2 text-pro-16 font-extrabold"
        >
          <ClipboardList className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
          {showForm
            ? ctx.report
              ? t("lessonReport.write.editTitle")
              : t("lessonReport.write.title")
            : t("lessonReport.title")}
        </h2>
        {isTutor && ctx.report && ctx.can_write && !editing ? (
          <button
            type="button"
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-pro-13 font-bold text-brand"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            {t("lessonReport.write.editTitle")}
          </button>
        ) : null}
      </div>

      {showForm ? (
        <LessonReportForm
          bookingId={bookingId}
          kind={ctx.kind}
          subjectCode={ctx.subject_code}
          existing={ctx.report}
          onDone={() => setEditing(false)}
        />
      ) : ctx.report ? (
        <LessonReportView report={ctx.report} tutorName={isTutor ? null : tutorName} />
      ) : (
        <p className="text-pro-13 text-muted-foreground">{t("lessonReport.waitingAfter")}</p>
      )}

      {href ? (
        <Link
          to={href}
          className="inline-block text-pro-13 font-bold text-brand underline-offset-2 hover:underline"
        >
          {ctx.learner_is_child && ctx.learner_name
            ? t("learnerProgress.linkLabel", { name: ctx.learner_name })
            : t("learnerProgress.selfLinkLabel")}
        </Link>
      ) : null}
    </section>
  );
}
