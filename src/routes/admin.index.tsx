import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdminQueryState } from "@/components/admin";
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
