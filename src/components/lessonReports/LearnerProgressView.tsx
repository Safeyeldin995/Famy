import { useTranslation } from "react-i18next";
import { BookOpen, Music2 } from "lucide-react";
import { EmptyState } from "@/components/famio/ui";
import { ICON_STROKE } from "@/lib/icons/constants";
import { currentLang } from "@/lib/i18n";
import { formatDate, formatNumber } from "@/lib/format";
import { ONLINE_WEB_TIME_ZONE } from "@/lib/online/onlineWebCairoTime";
import { useLearnerProgress } from "@/lib/db/lesson-report-queries";
import {
  juzWithProgress,
  percent,
  surahStatus,
  type LearnerProgress,
} from "@/lib/lessonReports/lessonReports";
import { LessonReportView } from "./LessonReportView";

const STATUS_TONE = {
  memorized: "bg-success/15 text-success",
  in_progress: "bg-brand/10 text-brand",
  reviewed: "bg-surface-2 text-muted-foreground",
} as const;

/** «تقدم {name}»: reports over time, Quran memorization and music level. */
export function LearnerProgressView({ learnerId }: { learnerId: string | null }) {
  const { t } = useTranslation();
  const q = useLearnerProgress(learnerId);
  if (q.isLoading) {
    return (
      <p className="text-pro-14 text-muted-foreground" aria-busy="true">
        {t("common.loading")}
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <p className="text-pro-14 text-coral">{t("learnerProgress.loadError")}</p>
        <button
          type="button"
          className="text-pro-13 font-bold text-brand underline"
          onClick={() => void q.refetch()}
        >
          {t("common.tryAgain")}
        </button>
      </div>
    );
  }
  return <LearnerProgressBody data={q.data} />;
}

function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || null;
}

export function LearnerProgressBody({ data }: { data: LearnerProgress }) {
  const { t } = useTranslation();
  const lang = currentLang();
  const num = (n: number) => formatNumber(n, lang);
  const name = firstName(data.learner.name);
  const title =
    data.learner.mode === "self" || !name
      ? t("learnerProgress.selfTitle")
      : t("learnerProgress.title", { name });
  const quran = data.quran;
  const juz = juzWithProgress(quran.juz);

  return (
    <div className="space-y-6" data-testid="learner-progress">
      <h1 className="text-pro-24 font-extrabold">{title}</h1>

      {quran.has_data ? (
        <section
          className="space-y-4 rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
          aria-labelledby="lp-quran"
        >
          <h2 id="lp-quran" className="flex items-center gap-2 text-pro-16 font-extrabold">
            <BookOpen className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
            {t("learnerProgress.quranTitle")}
          </h2>
          <div className="space-y-2">
            <p className="text-pro-14 font-bold tabular-nums">
              {t("learnerProgress.quranTotal", {
                memorized: num(quran.memorized_ayahs),
                total: num(quran.total_ayahs),
              })}
            </p>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent(quran.memorized_ayahs, quran.total_ayahs)}
              aria-label={t("learnerProgress.quranTitle")}
            >
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${percent(quran.memorized_ayahs, quran.total_ayahs)}%` }}
              />
            </div>
          </div>

          {juz.length ? (
            <div className="space-y-2">
              <h3 className="text-pro-13 font-bold text-muted-foreground">
                {t("learnerProgress.juzTitle")}
              </h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {juz.map((j) => {
                  const done = j.memorized_ayahs >= j.total_ayahs;
                  return (
                    <li key={j.juz} className="min-w-0 rounded-xl border border-border/60 p-2.5">
                      <p className="text-pro-13 font-bold">
                        {t("lessonReport.write.juzLabel", { n: num(j.juz) })}
                      </p>
                      <p
                        className={`text-pro-12 tabular-nums ${done ? "font-bold text-success" : "text-muted-foreground"}`}
                      >
                        {done
                          ? t("learnerProgress.juzComplete")
                          : t("learnerProgress.juzProgress", {
                              memorized: num(j.memorized_ayahs),
                              total: num(j.total_ayahs),
                            })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {quran.surahs.length ? (
            <div className="space-y-2">
              <h3 className="text-pro-13 font-bold text-muted-foreground">
                {t("learnerProgress.surahsTitle")}
              </h3>
              <ul className="divide-y divide-border/60">
                {quran.surahs.map((s) => {
                  const status = surahStatus(s);
                  return (
                    <li key={s.number} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-pro-14 font-bold">
                          <span className="tabular-nums text-muted-foreground">
                            {num(s.number)}.
                          </span>{" "}
                          {lang === "ar" ? s.name_ar : s.name_en}
                        </p>
                        <p className="text-pro-12 tabular-nums text-muted-foreground">
                          {status === "reviewed"
                            ? t("learnerProgress.surahReviewed", { count: num(s.reviewed_ayahs) })
                            : t("learnerProgress.surahAyahs", {
                                memorized: num(s.memorized_ayahs),
                                total: num(s.ayah_count),
                              })}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-pro-12 font-bold ${STATUS_TONE[status]}`}
                      >
                        {t(`learnerProgress.surahStatus.${status}`)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {data.music.length ? (
        <section
          className="space-y-3 rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
          aria-labelledby="lp-music"
        >
          <h2 id="lp-music" className="flex items-center gap-2 text-pro-16 font-extrabold">
            <Music2 className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
            {t("learnerProgress.musicTitle")}
          </h2>
          <ol className="space-y-2">
            {[...data.music].reverse().map((m) => (
              <li
                key={m.booking_id}
                className="flex flex-wrap items-center justify-between gap-2 text-pro-14"
              >
                <span>
                  {t(`lessonReport.instruments.${m.instrument}`)} ·{" "}
                  {t(`lessonReport.levels.${m.level}`)}
                  {m.piece ? <span className="text-muted-foreground"> · {m.piece}</span> : null}
                </span>
                <span className="text-pro-12 tabular-nums text-muted-foreground">
                  {formatDate(
                    new Date(m.start_at),
                    { day: "numeric", month: "short" },
                    lang,
                    ONLINE_WEB_TIME_ZONE,
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="lp-reports">
        <h2 id="lp-reports" className="text-pro-16 font-extrabold">
          {t("learnerProgress.reportsTitle")}
        </h2>
        {data.reports.length === 0 ? (
          <EmptyState title={t("learnerProgress.reportsTitle")} body={t("learnerProgress.empty")} />
        ) : (
          <ul className="space-y-3">
            {data.reports.map((r) => {
              const subject =
                (lang === "ar" ? r.subject_name_ar : r.subject_name_en) ?? r.subject_name_ar ?? "";
              return (
                <li
                  key={r.id}
                  className="space-y-2 rounded-2xl border border-border/60 bg-white p-4 shadow-sm"
                >
                  <p className="text-pro-13 font-bold tabular-nums">
                    {t("learnerProgress.lessonOn", {
                      date: formatDate(
                        new Date(r.start_at),
                        { weekday: "short", day: "numeric", month: "short" },
                        lang,
                        ONLINE_WEB_TIME_ZONE,
                      ),
                      subject: subject || t(`lessonReport.title`),
                    })}
                  </p>
                  {r.tutor_name ? (
                    <p className="text-pro-12 text-muted-foreground">
                      {t("learnerProgress.tutor", { name: r.tutor_name })}
                    </p>
                  ) : null}
                  <LessonReportView report={r} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
