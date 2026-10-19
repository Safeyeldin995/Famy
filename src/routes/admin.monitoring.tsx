import { adminErrorSummary } from "@/components/admin/adminPresentation";
import { AdminRelativeTime } from "@/components/admin/AdminRelativeTime";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { catalogScreen } from "@/components/admin/CatalogControls";
import { createFileRoute, type LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import {
  useAdminMonitoringSummary,
  useAdminRecentErrorLogs,
  useAdminRecentFailedNotifications,
  useAdminRecentFailedPayments,
  type FailedNotificationRow,
} from "@/lib/db/admin-monitoring-queries";

export const Route = createFileRoute("/admin/monitoring")({ component: AdminMonitoring });

function SummaryCard({
  title,
  description,
  count,
  to,
  search,
}: {
  title: string;
  description: string;
  count: number;
  to?: LinkProps["to"];
  search?: LinkProps["search"];
}) {
  const body = (
    <>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-extrabold">{count}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </>
  );

  if (!to) {
    return (
      <div className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">{body}</div>
    );
  }

  return (
    <Link
      to={typeof to === "string" ? (to as typeof to) : to}
      search={search}
      className="focus-ring rounded-2xl border border-border/60 bg-surface p-4 shadow-sm transition hover:border-brand/40"
    >
      {body}
    </Link>
  );
}

function SectionShell({
  title,
  count,
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  children,
}: {
  title: string;
  count: number;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <section className="rounded-2xl border border-border/60 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">{count}</span>
      </div>
      <div className="mt-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <AdminQueryError
            compact
            message={t("admin.monitoring.queueError")}
            error={error}
            onRetry={onRetry}
          />
        ) : isEmpty ? (
          <p className="text-xs text-muted-foreground">{t("admin.monitoring.queueEmpty")}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function AdminMonitoring() {
  const { t, i18n } = useTranslation();
  const summaryQ = useAdminMonitoringSummary();
  const errorLogsQ = useAdminRecentErrorLogs();
  const failedPaymentsQ = useAdminRecentFailedPayments();
  const failedNotificationsQ = useAdminRecentFailedNotifications();
  const summary = summaryQ.data;

  return (
    <div className={catalogScreen}>
      <div>
        <h1 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {t("admin.layout.nav.monitoring")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("admin.monitoring.subtitle")}</p>
      </div>

      {summaryQ.isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : summaryQ.isError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-coral/30 bg-coral/5 p-4 text-sm text-coral">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("admin.monitoring.summaryError")}
          <button
            onClick={() => summaryQ.refetch()}
            className="focus-ring ms-auto rounded-lg border border-coral px-3 py-1 text-xs font-bold"
          >
            {t("admin.monitoring.retry")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryCard
            title={t("admin.monitoring.recentErrors")}
            description={t("admin.monitoring.recentErrorsBody")}
            count={summary?.recent_errors ?? 0}
          />
          <SummaryCard
            title={t("admin.monitoring.failedPayments")}
            description={t("admin.monitoring.failedPaymentsBody")}
            count={summary?.failed_payments ?? 0}
            to={"/admin/payments" as "/admin/payments"}
            search={{ statuses: "failed,rejected" }}
          />
          <SummaryCard
            title={t("admin.monitoring.failedNotifications")}
            description={t("admin.monitoring.failedNotificationsBody")}
            count={summary?.failed_notifications ?? 0}
            to={"/admin/operations" as "/admin/operations"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionShell
          title={t("admin.monitoring.recentErrors")}
          count={errorLogsQ.data?.length ?? 0}
          isLoading={errorLogsQ.isLoading}
          isError={errorLogsQ.isError}
          error={errorLogsQ.error}
          onRetry={() => errorLogsQ.refetch()}
          isEmpty={(errorLogsQ.data?.length ?? 0) === 0}
        >
          <ul className="space-y-1.5">
            {(errorLogsQ.data ?? []).map((row) => (
              <li key={row.id} className="rounded-xl border border-border/60 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-coral/10 px-2 py-0.5 text-xs font-bold uppercase text-coral">
                    {t("adminCatalog.systemError")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <AdminRelativeTime value={row.created_at} />
                  </span>
                </div>
                <p className="mt-2">{adminErrorSummary(row.message_safe, i18n.language)}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    {t("admin.auditLog.details")}
                  </summary>
                  <p className="mt-1 break-words font-semibold" dir="ltr">
                    {row.message_safe}
                  </p>
                  {(row.context_route || row.context_label) && (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="ltr">
                      {[row.context_label, row.context_route].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </SectionShell>

        <SectionShell
          title={t("admin.monitoring.failedPayments")}
          count={failedPaymentsQ.data?.length ?? 0}
          isLoading={failedPaymentsQ.isLoading}
          isError={failedPaymentsQ.isError}
          error={failedPaymentsQ.error}
          onRetry={() => failedPaymentsQ.refetch()}
          isEmpty={(failedPaymentsQ.data?.length ?? 0) === 0}
        >
          <ul className="space-y-1.5">
            {(failedPaymentsQ.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border/60 p-2 text-xs"
              >
                <div>
                  <span className="rounded-full bg-coral/10 px-2 py-0.5 text-xs font-bold uppercase text-coral">
                    {t(`adminCatalog.states.${row.status}`, {
                      defaultValue: t("adminCatalog.unknown"),
                    })}
                  </span>
                  <details>
                    <summary>{t("admin.auditLog.details")}</summary>
                    <p dir="ltr" className="break-all text-xs">
                      {row.id} · {row.booking_id}
                    </p>
                  </details>
                  <p className="text-xs text-muted-foreground">
                    <AdminRelativeTime value={row.created_at} />
                  </p>
                </div>
                <Link
                  to={"/admin/payments" as "/admin/payments"}
                  search={{ status: row.status }}
                  className="focus-ring shrink-0 rounded-lg border border-border px-2 py-1 font-semibold text-brand"
                >
                  {t("admin.monitoring.review")}
                </Link>
              </li>
            ))}
          </ul>
        </SectionShell>

        <SectionShell
          title={t("admin.monitoring.failedNotifications")}
          count={failedNotificationsQ.data?.length ?? 0}
          isLoading={failedNotificationsQ.isLoading}
          isError={failedNotificationsQ.isError}
          error={failedNotificationsQ.error}
          onRetry={() => failedNotificationsQ.refetch()}
          isEmpty={(failedNotificationsQ.data?.length ?? 0) === 0}
        >
          <ul className="space-y-1.5">
            {(failedNotificationsQ.data ?? []).map((row: FailedNotificationRow) => (
              <li key={row.id} className="rounded-xl border border-border/60 p-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                    row.status === "dead" ? "bg-coral/10 text-coral" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {t(`adminCatalog.states.${row.status}`, {
                    defaultValue: t("adminCatalog.unknown"),
                  })}
                </span>
                <span className="ms-2 text-muted-foreground">
                  {t("admin.operations.attempts", { count: row.attempts })}
                </span>
                {row.last_error_safe && (
                  <>
                    <p className="mt-2">{adminErrorSummary(row.last_error_safe, i18n.language)}</p>
                    <details>
                      <summary>{t("admin.auditLog.details")}</summary>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="ltr">
                        {row.last_error_safe}
                      </p>
                    </details>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  <AdminRelativeTime value={row.created_at} />
                </p>
              </li>
            ))}
          </ul>
        </SectionShell>
      </div>
    </div>
  );
}
