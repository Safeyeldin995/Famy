import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminQueryState } from "@/components/admin";
import { AdminWorkQueue } from "@/components/admin/AdminWorkQueue";
import { AdminFinanceHomeStrip } from "@/components/admin/AdminFinanceHomeStrip";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { useAdminWorkQueueCounts } from "@/lib/db/admin-queries";
import {
  type AdminOpsProblems,
  useAdminOpsProblems,
  useAdminOpsToday,
} from "@/lib/db/admin-wallet-ops-queries";
import { formatEGP } from "@/lib/format/egp";

export const Route = createFileRoute("/admin/")({ component: AdminHome });

// Each card opens the exact list it counts (same SQL condition, #551).
const PROBLEM_LINKS: Record<
  keyof AdminOpsProblems,
  { route: string; search?: Record<string, string>; hash?: string }
> = {
  paymob_flags: { route: "/admin/payments", search: { tab: "paymob" } },
  attendance_failed: { route: "/admin/bookings", search: { filter: "attendance_failed" } },
  stuck_active: { route: "/admin/bookings", search: { filter: "stuck_active" } },
  stuck_pending: { route: "/admin/bookings", search: { filter: "stuck_pending" } },
  push_failures: { route: "/admin/monitoring", hash: "failed-notifications" },
  app_errors: { route: "/admin/monitoring", hash: "recent-errors" },
};

function AdminHome() {
  const { t, i18n } = useTranslation();
  const queue = useAdminWorkQueueCounts();
  const today = useAdminOpsToday();
  const problems = useAdminOpsProblems();
  const egp = (n: number) => formatEGP(n, undefined, i18n.language);
  const dateLabel = new Intl.DateTimeFormat(
    i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Africa/Cairo",
    },
  ).format(new Date());

  const stats = today.data
    ? [
        { key: "lessons", value: today.data.lessons_today.toLocaleString("en-US") },
        { key: "requests", value: today.data.requests_today.toLocaleString("en-US") },
        { key: "completed", value: today.data.completed_today.toLocaleString("en-US") },
        { key: "cancelled", value: today.data.cancelled_today.toLocaleString("en-US") },
        { key: "paid", value: egp(today.data.paid_today) },
        { key: "commission", value: egp(today.data.commission_today) },
      ]
    : [];

  const openProblems = problems.data
    ? (Object.keys(PROBLEM_LINKS) as (keyof AdminOpsProblems)[]).filter((k) => problems.data[k] > 0)
    : [];

  return (
    <main className="space-y-6 px-4 py-5 sm:px-6">
      <div>
        <h1 className="text-xl font-extrabold">{t("adminHome.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p>
      </div>

      {today.isError ? (
        <AdminQueryError
          compact
          message={t("adminHome.loadError")}
          error={today.error}
          onRetry={() => today.refetch()}
        />
      ) : (
        <section
          aria-label={t("adminHome.title")}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
        >
          {today.isLoading
            ? Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="h-[4.5rem] animate-pulse rounded-2xl border border-border bg-surface"
                />
              ))
            : stats.map((s) => (
                <div
                  key={s.key}
                  className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm"
                >
                  <p className="text-xs text-muted-foreground">{t(`adminHome.today.${s.key}`)}</p>
                  <p className="mt-1 text-lg font-extrabold tabular-nums">{s.value}</p>
                </div>
              ))}
        </section>
      )}

      <AdminQueryState
        isLoading={queue.isLoading}
        isError={queue.isError}
        error={queue.error}
        onRetry={() => queue.refetch()}
        errorMessage={t("adminHome.loadError")}
        skeletonCount={6}
      >
        {() => (queue.data ? <AdminWorkQueue counts={queue.data} /> : null)}
      </AdminQueryState>

      <section aria-label={t("adminHome.problems")} className="space-y-3">
        <h2 className="text-base font-extrabold">{t("adminHome.problems")}</h2>
        {problems.isError ? (
          <AdminQueryError
            compact
            message={t("adminHome.loadError")}
            error={problems.error}
            onRetry={() => problems.refetch()}
          />
        ) : problems.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : openProblems.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-4 text-sm font-semibold text-success">
            {t("adminHome.noProblems")}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {openProblems.map((k) => (
              <li key={k}>
                <Link
                  to={PROBLEM_LINKS[k].route as never}
                  search={PROBLEM_LINKS[k].search as never}
                  hash={PROBLEM_LINKS[k].hash}
                  className="focus-ring block rounded-2xl border border-coral/40 bg-coral/5 px-4 py-3 hover:border-coral"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold">{t(`adminHome.problem.${k}`)}</span>
                    <span className="text-lg font-extrabold tabular-nums text-coral">
                      {problems.data![k].toLocaleString("en-US")}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(`adminHome.problemDo.${k}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AdminFinanceHomeStrip />
    </main>
  );
}
