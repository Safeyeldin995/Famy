import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminQueryState } from "@/components/admin";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { AdminWorkQueue } from "@/components/admin/AdminWorkQueue";
import { useAdminWorkQueueCounts } from "@/lib/db/admin-queries";

export const Route = createFileRoute("/admin/")({ component: AdminHome });

function AdminHome() {
  const { t } = useTranslation();
  const queue = useAdminWorkQueueCounts();

  return (
    <main className="space-y-5 px-4 py-5 sm:px-6">
      <div>
        <h1 className="text-xl font-extrabold">{t("adminWorkQueue.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("adminWorkQueue.subtitle")}</p>
      </div>
      <p className="mb-3">
        <Link
          to="/admin/finance"
          className="focus-ring inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-sm font-bold"
        >
          {t("admin.finance.openDashboard")}
        </Link>
      </p>
      <AdminQueryState
        isLoading={queue.isLoading}
        isError={queue.isError}
        error={queue.error}
        onRetry={() => queue.refetch()}
        errorMessage={t("adminWorkQueue.loadError")}
        skeletonCount={8}
      >
        {() => queue.data ? <AdminWorkQueue counts={queue.data} /> : null}
      </AdminQueryState>
    </main>
  );
}
