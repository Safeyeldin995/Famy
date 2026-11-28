import { useTranslation } from "react-i18next";
import { BookOpen, Music2, NotebookPen } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";
import { currentLang } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { formatQuranRange, type LessonReport } from "@/lib/lessonReports/lessonReports";

const UNDERSTANDING_TONE: Record<string, string> = {
  needs_support: "bg-warning/15 text-warning",
  good: "bg-brand/10 text-brand",
  excellent: "bg-success/15 text-success",
};

/** Read-only lesson report: what was covered, homework, rating, Quran ranges, music level. */
export function LessonReportView({
  report,
  tutorName,
}: {
  report: LessonReport;
  tutorName?: string | null;
}) {
  const { t } = useTranslation();
  const lang = currentLang();
  const num = (n: number) => formatNumber(n, lang);
  return (
    <div className="space-y-3" data-testid="lesson-report-view">
      {tutorName ? (
        <p className="text-pro-12 text-muted-foreground">
          {t("lessonReport.by", { name: tutorName })}
        </p>
      ) : null}
      <div>
        <p className="text-pro-12 font-bold text-muted-foreground">{t("lessonReport.covered")}</p>
        <p className="mt-0.5 whitespace-pre-line text-pro-14 text-foreground">{report.covered}</p>
      </div>
      <div>
        <p className="text-pro-12 font-bold text-muted-foreground">{t("lessonReport.homework")}</p>
        <p className="mt-0.5 whitespace-pre-line text-pro-14 text-foreground">
          {report.homework || t("lessonReport.noHomework")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-pro-12 font-bold text-muted-foreground">
          {t("lessonReport.understanding")}
        </p>
        <span
          className={`rounded-full px-3 py-1 text-pro-12 font-bold ${UNDERSTANDING_TONE[report.understanding] ?? ""}`}
        >
          {t(`lessonReport.understandingValues.${report.understanding}`)}
        </span>
      </div>
      {report.kind === "quran" && report.quran.length > 0 ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-pro-12 font-bold text-muted-foreground">
            <BookOpen className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            {t("lessonReport.quranTitle")}
          </p>
          <ul className="space-y-1">
            {report.quran.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-pro-14">
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-pro-12 font-bold">
                  {t(`lessonReport.quranKinds.${e.kind}`)}
                </span>
                <span className="tabular-nums">{formatQuranRange(e, lang, undefined, num)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.kind === "music" && report.music_instrument ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-pro-12 font-bold text-muted-foreground">
            <Music2 className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
            {t("lessonReport.musicTitle")}
          </p>
          <p className="text-pro-14">
            {t(`lessonReport.instruments.${report.music_instrument}`)}
            {report.music_level ? ` · ${t(`lessonReport.levels.${report.music_level}`)}` : ""}
          </p>
          {report.music_piece ? (
            <p className="flex items-center gap-1.5 text-pro-13 text-muted-foreground">
              <NotebookPen className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
              {report.music_piece}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
