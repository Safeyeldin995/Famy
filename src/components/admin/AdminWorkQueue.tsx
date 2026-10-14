import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { useTranslation } from "react-i18next";
import type { AdminWorkQueueKey } from "@/lib/db/admin-work-queue";

export const WORK_QUEUE_ITEMS: ReadonlyArray<{
  key: AdminWorkQueueKey;
  route: string;
  search?: Record<string, string>;
}> = [
  { key: "new_applications", route: "/admin/providers", search: { queue: "new_applications" } },
  {
    key: "resubmitted_applications",
    route: "/admin/providers",
    search: { queue: "resubmitted_applications" },
  },
  { key: "pending_services", route: "/admin/providers", search: { queue: "pending_services" } },
  {
    key: "pending_teaching_groups",
    route: "/admin/providers",
    search: { queue: "pending_teaching_groups" },
  },
  { key: "pending_documents", route: "/admin/providers", search: { queue: "pending_documents" } },
  { key: "open_cases", route: "/admin/cases" },
  {
    key: "bookings_needing_action",
    route: "/admin/bookings",
    search: { statuses: "disputed,no_show" },
  },
  {
    key: "payments_pending_review",
    route: "/admin/payments",
    search: { status: "pending_review" },
  },
];

export function AdminWorkQueue({ counts }: { counts: Record<AdminWorkQueueKey, number> }) {
  const { t } = useTranslation();
  const empty = WORK_QUEUE_ITEMS.every((item) => counts[item.key] === 0);

  return (
    <section aria-label={t("adminWorkQueue.title")}>
      {empty && (
        <p className="mb-4 rounded-2xl border border-border bg-surface p-5 text-center text-base font-bold">
          {t("adminWorkQueue.empty")}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {WORK_QUEUE_ITEMS.map((item) => (
          <Link
            key={item.key}
            to={item.route as any}
            search={item.search as any}
            className="focus-ring flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm hover:border-brand"
          >
            <span className="text-sm font-semibold">{t(`adminWorkQueue.${item.key}`)}</span>
            <span
              className={`min-w-10 rounded-xl px-2 py-1 text-center text-lg font-extrabold tabular-nums ${counts[item.key] > 0 ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground"}`}
            >
              {counts[item.key].toLocaleString("en-US")}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
