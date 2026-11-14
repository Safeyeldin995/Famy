import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AdminQueryState } from "@/components/admin";
import { useLang } from "@/components/famio/LanguageToggle";
import { sumDaily, useAdminGrowthMetrics, type GrowthDay } from "@/lib/db/admin-growth-queries";
import { formatEGP } from "@/lib/utils";

export const Route = createFileRoute("/admin/performance")({ component: AdminPerformancePage });

const RANGES = [7, 30, 90] as const;
const BRAND = "var(--color-brand, #E0146F)";
const FUNNEL_ORDER = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
];

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

function dayLabel(day: string, lang: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(lang.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap text-2xl font-extrabold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function DailyChart({
  title,
  data,
  field,
  money = false,
  lang,
  emptyLabel,
}: {
  title: string;
  data: GrowthDay[];
  field: keyof Omit<GrowthDay, "day">;
  money?: boolean;
  lang: string;
  emptyLabel: string;
}) {
  const rows = data.map((d) => ({ label: dayLabel(d.day, lang), value: d[field] }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const fmt = (v: number) => (money ? formatEGP(v) : fmtInt(v));
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold">{title}</h3>
        <span className="text-sm font-extrabold tabular-nums">{fmt(total)}</span>
      </div>
      {total === 0 ? (
        <p className="flex h-40 items-center justify-center rounded-xl bg-surface-2/50 text-xs text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <div dir="ltr" className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.6} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={money ? 56 : 32}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickFormatter={(v: number) => fmtInt(v)}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                formatter={(v: number) => [fmt(v), title]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-foreground)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function BarList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { label: string; value: number }[];
  emptyLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-extrabold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold">{r.label}</span>
                <span className="font-extrabold tabular-nums">{fmtInt(r.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2">
                <div
                  className="h-2 rounded-full bg-brand"
                  style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AdminPerformancePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useAdminGrowthMetrics(days);
  const empty = t("admin.performance.noData");

  return (
    <main className="space-y-6 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">{t("admin.performance.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("admin.performance.subtitle")}</p>
        </div>
        <div className="flex gap-2" role="group" aria-label={t("admin.performance.range")}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`focus-ring min-h-11 rounded-xl border px-4 text-sm font-bold ${
                days === d
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-background text-foreground"
              }`}
            >
              {t(`admin.performance.last${d}`)}
            </button>
          ))}
        </div>
      </header>

      <AdminQueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => q.refetch()}
        errorMessage={t("admin.performance.loadError")}
        skeletonCount={6}
      >
        {() => {
          const m = q.data;
          if (!m) return null;
          const s = sumDaily(m.daily);
          const finished = s.bookings_completed + s.bookings_cancelled;
          const cancelRate = finished > 0 ? Math.round((s.bookings_cancelled / finished) * 100) : 0;
          const repeatRate =
            m.totals.customers_with_booking > 0
              ? Math.round((m.totals.repeat_customers / m.totals.customers_with_booking) * 100)
              : 0;
          const funnelRows = FUNNEL_ORDER.filter((k) => (m.provider_funnel[k] ?? 0) > 0).map(
            (k) => ({
              label: t(`admin.performance.funnel.${k}`),
              value: m.provider_funnel[k] ?? 0,
            }),
          );
          const serviceRows = m.top_services.map((x) => ({
            label: lang.startsWith("ar") ? x.name_ar || x.name_en : x.name_en || x.name_ar,
            value: x.bookings,
          }));
          return (
            <div className="space-y-6">
              <section className="space-y-3">
                <h2 className="text-base font-extrabold">{t("admin.performance.periodTitle")}</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <StatTile
                    label={t("admin.performance.newCustomers")}
                    value={fmtInt(s.new_customers)}
                    sub={t("admin.performance.totalOf", { n: fmtInt(m.totals.customers_total) })}
                  />
                  <StatTile
                    label={t("admin.performance.newProviders")}
                    value={fmtInt(s.new_providers)}
                    sub={t("admin.performance.approvedOf", {
                      approved: fmtInt(m.totals.providers_approved),
                      total: fmtInt(m.totals.providers_total),
                    })}
                  />
                  <StatTile
                    label={t("admin.performance.newBookings")}
                    value={fmtInt(s.bookings_created)}
                    sub={t("admin.performance.totalOf", { n: fmtInt(m.totals.bookings_total) })}
                  />
                  <StatTile
                    label={t("admin.performance.completedBookings")}
                    value={fmtInt(s.bookings_completed)}
                    sub={t("admin.performance.cancelRate", { rate: cancelRate })}
                  />
                  <StatTile
                    label={t("admin.performance.revenue")}
                    value={formatEGP(s.revenue)}
                    sub={t("admin.performance.revenueHint")}
                  />
                  <StatTile
                    label={t("admin.performance.platformShare")}
                    value={formatEGP(s.platform_share)}
                    sub={t("admin.performance.platformShareHint")}
                  />
                </div>
              </section>

              <section className="grid gap-3 lg:grid-cols-2">
                <DailyChart
                  title={t("admin.performance.chartCustomers")}
                  data={m.daily}
                  field="new_customers"
                  lang={lang}
                  emptyLabel={empty}
                />
                <DailyChart
                  title={t("admin.performance.chartProviders")}
                  data={m.daily}
                  field="new_providers"
                  lang={lang}
                  emptyLabel={empty}
                />
                <DailyChart
                  title={t("admin.performance.chartBookings")}
                  data={m.daily}
                  field="bookings_created"
                  lang={lang}
                  emptyLabel={empty}
                />
                <DailyChart
                  title={t("admin.performance.chartRevenue")}
                  data={m.daily}
                  field="revenue"
                  money
                  lang={lang}
                  emptyLabel={empty}
                />
              </section>

              <section className="grid gap-3 lg:grid-cols-2">
                <BarList
                  title={t("admin.performance.funnelTitle")}
                  rows={funnelRows}
                  emptyLabel={empty}
                />
                <BarList
                  title={t("admin.performance.topServices")}
                  rows={serviceRows}
                  emptyLabel={empty}
                />
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-extrabold">{t("admin.performance.qualityTitle")}</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile
                    label={t("admin.performance.ratingAvg")}
                    value={m.totals.rating_avg != null ? m.totals.rating_avg.toFixed(1) : "—"}
                    sub={t("admin.performance.ratingCount", { n: fmtInt(m.totals.rating_count) })}
                  />
                  <StatTile
                    label={t("admin.performance.repeatRate")}
                    value={t("admin.performance.percent", { n: repeatRate })}
                    sub={t("admin.performance.repeatHint")}
                  />
                  <StatTile
                    label={t("admin.performance.cancelRateTitle")}
                    value={t("admin.performance.percent", { n: cancelRate })}
                    sub={t("admin.performance.cancelRateHint")}
                  />
                  <StatTile
                    label={t("admin.performance.customersWithBooking")}
                    value={fmtInt(m.totals.customers_with_booking)}
                    sub={t("admin.performance.totalOf", { n: fmtInt(m.totals.customers_total) })}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-extrabold">{t("admin.performance.appTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{t("admin.performance.appHint")}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <StatTile
                    label={t("admin.performance.appCustomers")}
                    value={fmtInt(m.app.customers)}
                  />
                  <StatTile
                    label={t("admin.performance.appProviders")}
                    value={fmtInt(m.app.providers)}
                  />
                  <StatTile
                    label={t("admin.performance.appAndroid")}
                    value={fmtInt(m.app.android)}
                  />
                  <StatTile label={t("admin.performance.appIos")} value={fmtInt(m.app.ios)} />
                  <StatTile
                    label={t("admin.performance.appActive7")}
                    value={fmtInt(m.app.active_7d)}
                  />
                  <StatTile
                    label={t("admin.performance.appActive30")}
                    value={fmtInt(m.app.active_30d)}
                  />
                </div>
              </section>
            </div>
          );
        }}
      </AdminQueryState>
    </main>
  );
}
