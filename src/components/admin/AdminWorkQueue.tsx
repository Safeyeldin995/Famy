import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useTranslation } from "react-i18next";
import type { AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

/**
 * "What needs you" on the admin home, in the order an operator handles it:
 * money and customers first, then bookings, then providers.
 */
export const WORK_QUEUE_ITEMS: ReadonlyArray<{
  key: AdminWorkQueueKey;
  route: string;
  search?: Record<string, string>;
}> = [
  { key: "payments_pending_review", route: "/admin/payments", search: { tab: "needs_action" } },
  { key: "open_cases", route: "/admin/cases" },
  {
    key: "bookings_needing_action",
    route: "/admin/bookings",
    search: { statuses: "disputed,no_show" },
  },
  {
    key: "bookings_lifecycle_attention",
    route: "/admin/bookings",
    search: { filter: "lifecycle_attention" },
  },
  { key: "online_lesson_issue_reports", route: "/admin/online-lesson-issues" },
  { key: "ugc_reports", route: "/admin/reports-ugc" },
  { key: "new_applications", route: "/admin/providers", search: { queue: "new_applications" } },
  {
    key: "resubmitted_applications",
    route: "/admin/providers",
    search: { queue: "resubmitted_applications" },
  },
  {
    key: "applications_over_sla",
    route: "/admin/providers",
    search: { queue: "applications_over_sla" },
  },
  { key: "pending_documents", route: "/admin/providers", search: { queue: "pending_documents" } },
  { key: "pending_services", route: "/admin/providers", search: { queue: "pending_services" } },
  {
    key: "pending_teaching_groups",
    route: "/admin/providers",
    search: { queue: "pending_teaching_groups" },
  },
  {
    key: "tutors_missing_teaching_data",
    route: "/admin/providers",
    search: { queue: "tutors_missing_teaching_data" },
  },
  { key: "new_service_requests", route: "/admin/service-requests" },
  { key: "price_change_requests", route: "/admin/price-change-requests" },
  { key: "documents_expiring_soon", route: "/admin/documents-expiring" },
  { key: "providers_at_cash_limit", route: "/admin/finance" },
];

export function AdminWorkQueue({ counts }: { counts: Record<AdminWorkQueueKey, number> }) {
  const { t } = useTranslation();
  const open = WORK_QUEUE_ITEMS.filter((item) => (counts[item.key] ?? 0) > 0);
  const done = WORK_QUEUE_ITEMS.filter((item) => (counts[item.key] ?? 0) === 0);

  return (
    <section aria-label={t("adminHome.needsYou")} className="space-y-3">
      <h2 className="text-base font-extrabold">{t("adminHome.needsYou")}</h2>
      {open.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-5 text-center text-sm font-bold">
          {t("adminHome.allClear")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((item) => (
            <Link
              key={item.key}
              to={item.route as never}
              search={item.search as never}
              className="focus-ring flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm hover:border-brand"
            >
              <span className="text-sm font-semibold">{t(`adminHome.queue.${item.key}`)}</span>
              <span className="min-w-10 rounded-xl bg-brand/10 px-2 py-1 text-center text-lg font-extrabold tabular-nums text-brand">
                {counts[item.key].toLocaleString("en-US")}
              </span>
            </Link>
          ))}
        </div>
      )}
      {open.length > 0 && done.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminHome.restClear", { count: done.length })}
        </p>
      ) : null}
    </section>
  );
}
