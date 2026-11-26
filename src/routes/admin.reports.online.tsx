import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, ExternalLink } from "lucide-react";
import {
  cairoMidnight,
  financeRangeForDays,
  statementRangeForPreset,
} from "@/lib/settlement/cairoSettlementWeek";
import {
  useAdminOnlineLessonFilterOptions,
  useAdminOnlineLessonsReport,
} from "@/lib/db/admin-online-lessons-queries";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { adminControl, adminScreen } from "@/components/admin/operations";
import { formatEGP } from "@/lib/utils";
import { useLang } from "@/components/famio/LanguageToggle";
import { downloadOnlineLessonsBookingsCsv } from "@/lib/admin/onlineLessonsReportExport";

export const Route = createFileRoute("/admin/reports/online")({
  component: AdminOnlineLessonsReportPage,
});

type Preset = "today" | "7d" | "30d" | "thisMonth" | "custom";

const KPI_KEYS = [
  "requests",
  "confirmation_rate",
  "paid_rate",
  "completed",
  "gross_lesson_value",
  "famy_commission",
  "teacher_earnings",
  "wallet_refund_credits",
  "wallet_credit_used",
] as const;

const MONEY_KEYS = new Set([
  "gross_lesson_value",
  "famy_commission",
  "teacher_earnings",
  "wallet_refund_credits",
  "wallet_credit_used",
]);

const RATE_KEYS = new Set(["confirmation_rate", "paid_rate"]);

function cairoParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function rangeForPreset(preset: Exclude<Preset, "custom">, now = new Date()) {
  if (preset === "thisMonth") return statementRangeForPreset("thisMonth", now);
  const c = cairoParts(now);
  if (preset === "today") {
    return { from: cairoMidnight(c.y, c.m, c.d).toISOString(), to: now.toISOString() };
  }
  const days = preset === "7d" ? 7 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

function StatTile({ label, value, delta }: { label: string; value: string; delta: string | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap text-2xl font-extrabold tabular-nums">{value}</p>
      {delta ? <p className="text-xs text-muted-foreground">{delta}</p> : null}
    </div>
  );
}

function AdminOnlineLessonsReportPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const [preset, setPreset] = useState<Preset>("30d");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [providerId, setProviderId] = useState<string>("");
  const [anchor, setAnchor] = useState(() => new Date().toISOString());

  const range = useMemo(() => {
    if (preset === "custom") return financeRangeForDays(fromDay, toDay);
    return rangeForPreset(preset, new Date(anchor));
  }, [preset, fromDay, toDay, anchor]);

  const filtersQ = useAdminOnlineLessonFilterOptions();
  const q = useAdminOnlineLessonsReport(
    range?.from,
    range?.to,
    subjectId || null,
    providerId || null,
  );

  const formatCount = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");

  const formatKpiValue = (key: (typeof KPI_KEYS)[number], n: number | null | undefined) => {
    if (n == null) return "—";
    if (MONEY_KEYS.has(key)) return formatEGP(n);
    if (RATE_KEYS.has(key)) return `${(Number(n) * 100).toFixed(1)}%`;
    return formatCount(n);
  };

  const formatDelta = (key: (typeof KPI_KEYS)[number], change: number | null | undefined) => {
    if (change == null) return t("admin.onlineReports.noCompare");
    const pct = (Number(change) * 100).toFixed(1);
    const label = Number(change) >= 0 ? `+${pct}%` : `${pct}%`;
    return t("admin.onlineReports.vsPrevious", { label });
  };

  const subjectLabel = (en: string, ar: string) => (lang.startsWith("ar") ? ar || en : en || ar);

  const dowLabels = useMemo(
    () =>
      [0, 1, 2, 3, 4, 5, 6].map((dow) =>
        new Intl.DateTimeFormat(lang.startsWith("ar") ? "ar-EG" : "en-US", {
          weekday: "short",
          timeZone: "Africa/Cairo",
        }).format(new Date(Date.UTC(2024, 0, 7 + dow))),
      ),
    [lang],
  );

  const heatmapMax = Math.max(1, ...(q.data?.heatmap.map((c) => c.lessons) ?? [1]));
  const empty = q.data && q.data.has_activity === false;

  const exportLabels = useMemo(
    () => ({
      booking_id: t("admin.onlineReports.export.bookingId"),
      start_at: t("admin.onlineReports.export.date"),
      subject: t("admin.onlineReports.export.subject"),
      teacher_name: t("admin.onlineReports.export.teacher"),
      student_phone_masked: t("admin.onlineReports.export.student"),
      status: t("admin.onlineReports.export.status"),
      price_total: t("admin.onlineReports.export.total"),
      price_commission_amount: t("admin.onlineReports.export.commission"),
      price_provider_net: t("admin.onlineReports.export.teacherShare"),
      payment_method: t("admin.onlineReports.export.paymentMethod"),
    }),
    [t],
  );

  return (
    <div className={adminScreen}>
      <h1 className="text-xl font-bold">{t("admin.onlineReports.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("admin.onlineReports.subtitle")}</p>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["today", t("admin.onlineReports.preset.today")],
            ["7d", t("admin.onlineReports.preset.days7")],
            ["30d", t("admin.onlineReports.preset.days30")],
            ["thisMonth", t("admin.statement.thisMonth")],
            ["custom", t("admin.statement.custom")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${adminControl} ${preset === key ? "bg-brand text-brand-foreground" : ""}`}
            onClick={() => {
              setPreset(key);
              setAnchor(new Date().toISOString());
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "custom" ? (
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            className="min-h-11 rounded-xl border px-3"
            aria-label={t("admin.statement.from")}
          />
          <input
            type="date"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            className="min-h-11 rounded-xl border px-3"
            aria-label={t("admin.statement.to")}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <select
          className={`${adminControl} min-w-48`}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          aria-label={t("admin.onlineReports.filterSubject")}
        >
          <option value="">{t("admin.onlineReports.allSubjects")}</option>
          {(filtersQ.data?.services ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {subjectLabel(s.name_en, s.name_ar)}
            </option>
          ))}
        </select>
        <select
          className={`${adminControl} min-w-48`}
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          aria-label={t("admin.onlineReports.filterTeacher")}
        >
          <option value="">{t("admin.onlineReports.allTeachers")}</option>
          {(filtersQ.data?.providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${adminControl} inline-flex items-center gap-2`}
          disabled={!q.data?.export_rows.length}
          onClick={() =>
            q.data &&
            downloadOnlineLessonsBookingsCsv(q.data, exportLabels, "famy_online_lessons.csv")
          }
        >
          <FileSpreadsheet className="h-4 w-4" />
          {t("admin.onlineReports.exportCsv")}
        </button>
      </div>

      {q.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : q.isError ? (
        <AdminQueryError message={t("admin.onlineReports.loadError")} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          {empty ? (
            <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("admin.onlineReports.empty")}
            </p>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {KPI_KEYS.map((key) => (
              <StatTile
                key={key}
                label={t(`admin.onlineReports.kpi.${key}`)}
                value={formatKpiValue(key, q.data!.kpis.period[key]?.current)}
                delta={formatDelta(key, q.data!.kpis.period[key]?.change)}
              />
            ))}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-extrabold">{t("admin.onlineReports.funnelTitle")}</h2>
            <ol className="grid gap-2 text-sm sm:grid-cols-5">
              {(
                [
                  ["request", q.data.funnel.request],
                  ["confirmed", q.data.funnel.confirmed],
                  ["paid", q.data.funnel.paid],
                  ["joined", q.data.funnel.joined],
                  ["completed", q.data.funnel.completed],
                ] as const
              ).map(([step, count]) => (
                <li key={step} className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    {t(`admin.onlineReports.funnel.${step}`)}
                  </p>
                  <p className="text-lg font-extrabold tabular-nums">{formatCount(count)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold">
                {t("admin.onlineReports.cancellationsTitle")}
              </h2>
              <ul className="space-y-2 text-sm">
                {(["student_free", "student_late", "teacher", "admin", "system"] as const).map(
                  (kind) => {
                    const row = q.data!.cancellations[kind];
                    return (
                      <li
                        key={kind}
                        className="flex justify-between gap-2 border-b border-border/60 pb-2"
                      >
                        <span>{t(`admin.onlineReports.cancellations.${kind}`)}</span>
                        <span className="tabular-nums font-bold">
                          {formatCount(row?.count)} · {formatEGP(Number(row?.amount ?? 0))}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold">
                {t("admin.onlineReports.qualityTitle")}
              </h2>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-2">
                  <span>{t("admin.onlineReports.quality.joinRate")}</span>
                  <span className="font-bold tabular-nums">
                    {q.data.quality.join_rate != null
                      ? `${(Number(q.data.quality.join_rate) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span>{t("admin.onlineReports.quality.avgDuration")}</span>
                  <span className="font-bold tabular-nums">
                    {t("admin.onlineReports.quality.minutes", {
                      count: Number(q.data.quality.avg_attended_minutes ?? 0).toFixed(1),
                    })}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span>{t("admin.onlineReports.quality.noShows")}</span>
                  <span className="font-bold tabular-nums">
                    {formatCount(q.data.quality.no_show_reports)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>{t("admin.onlineReports.quality.issues")}</span>
                  <span className="inline-flex items-center gap-2 font-bold tabular-nums">
                    {formatCount(q.data.quality.open_issue_reports)}
                    <Link
                      to="/admin/online-lesson-issues"
                      className="inline-flex items-center gap-1 text-xs text-brand"
                    >
                      {t("admin.onlineReports.quality.viewIssues")}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <p className="overflow-x-auto rounded-2xl border border-border bg-surface p-4 shadow-sm lg:col-span-1">
              <h2 className="mb-3 text-sm font-extrabold">
                {t("admin.onlineReports.topTeachers")}
              </h2>
              {(q.data.top_teachers ?? []).length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("admin.onlineReports.emptyTable")}
                </span>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-start text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-2">{t("admin.onlineReports.colTeacher")}</th>
                      <th className="pb-2">{t("admin.onlineReports.colLessons")}</th>
                      <th className="pb-2">{t("admin.onlineReports.colCompletion")}</th>
                      <th className="pb-2">{t("admin.onlineReports.colEarnings")}</th>
                      <th className="pb-2">{t("admin.onlineReports.colRating")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.top_teachers.map((row) => (
                      <tr key={row.provider_id} className="border-t">
                        <td className="py-2">{row.provider_name}</td>
                        <td className="py-2 tabular-nums">{formatCount(row.lessons)}</td>
                        <td className="py-2 tabular-nums">
                          {row.completion_rate != null
                            ? `${(Number(row.completion_rate) * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                        <td className="py-2 tabular-nums">{formatEGP(Number(row.earnings))}</td>
                        <td className="py-2 tabular-nums">{Number(row.rating_avg).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </p>
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold">
                {t("admin.onlineReports.topSubjects")}
              </h2>
              {(q.data.top_subjects ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("admin.onlineReports.emptyTable")}
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {q.data.top_subjects.map((row) => (
                    <li
                      key={row.service_id}
                      className="flex justify-between gap-2 border-b border-border/60 pb-2"
                    >
                      <span>{subjectLabel(row.subject_name_en, row.subject_name_ar)}</span>
                      <span className="tabular-nums font-bold">
                        {formatCount(row.lessons)} · {formatEGP(Number(row.revenue))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="overflow-x-auto rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-extrabold">{t("admin.onlineReports.heatmapTitle")}</h2>
            {(q.data.heatmap ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("admin.onlineReports.emptyTable")}</p>
            ) : (
              <table className="w-full min-w-[48rem] text-xs">
                <thead>
                  <tr>
                    <th className="p-1 text-start">{t("admin.onlineReports.heatmap.day")}</th>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <th key={hour} className="p-1 text-center font-normal text-muted-foreground">
                        {hour}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dowLabels.map((label, dow) => (
                    <tr key={label}>
                      <td className="whitespace-nowrap p-1 font-semibold">{label}</td>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const cell = q.data!.heatmap.find((c) => c.dow === dow && c.hour === hour);
                        const lessons = cell?.lessons ?? 0;
                        const intensity = lessons / heatmapMax;
                        return (
                          <td
                            key={hour}
                            className="p-1 text-center tabular-nums"
                            style={{
                              backgroundColor:
                                lessons > 0
                                  ? `color-mix(in srgb, var(--color-brand) ${Math.round(intensity * 55 + 5)}%, transparent)`
                                  : undefined,
                            }}
                            title={String(lessons)}
                          >
                            {lessons > 0 ? lessons : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
