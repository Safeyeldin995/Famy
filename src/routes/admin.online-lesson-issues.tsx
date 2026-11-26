import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { operationDate, bookingCode } from "@/components/admin/operations";
import { AdminQueryError } from "@/components/admin/AdminQueryError";
import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { useResolveOnlineLessonIssue } from "@/lib/db/admin-online-lesson-queries";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/online-lesson-issues")({
  component: AdminOnlineLessonIssues,
});

type IssueRow = {
  id: string;
  booking_id: string;
  category: string;
  priority: string;
  minor_involved: boolean;
  reporter_role: string;
  description: string;
  created_at: string;
};

function AdminOnlineLessonIssues() {
  const { t, i18n } = useTranslation();
  const resolve = useResolveOnlineLessonIssue();
  const [sheet, setSheet] = useState<{
    id: string;
    status: "resolved" | "rejected";
  } | null>(null);
  const q = useQuery({
    queryKey: ["admin-online-lesson-issues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_lesson_issue_reports" as never)
        .select(
          "id, booking_id, category, priority, minor_involved, reporter_role, description, created_at",
        )
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as IssueRow[];
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t("admin.onlineLessonIssues.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("admin.onlineLessonIssues.subtitle")}</p>
      {q.isLoading ? <p className="mt-6">{t("common.loading")}</p> : null}
      {q.isError ? (
        <div className="mt-6">
          <AdminQueryError message={t("common.error")} onRetry={() => q.refetch()} />
        </div>
      ) : null}
      {!q.isLoading && !q.isError && !(q.data ?? []).length ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("admin.onlineLessonIssues.empty")}</p>
      ) : null}
      <ul className="mt-6 space-y-3">
        {(q.data ?? []).map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {t(`admin.onlineLessonIssues.categories.${row.category}`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {operationDate(row.created_at, i18n.language)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              <Link
                to="/admin/bookings"
                search={{ booking: row.booking_id }}
                className="font-mono text-brand hover:underline"
              >
                {bookingCode(row.booking_id)}
              </Link>
              {" · "}
              {t(`admin.onlineLessonIssues.roles.${row.reporter_role}`)}
              {row.priority === "high" ? ` · ${t("admin.onlineLessonIssues.highPriority")}` : ""}
              {row.minor_involved ? ` · ${t("admin.onlineLessonIssues.minorInvolved")}` : ""}
            </p>
            <p className="mt-2 text-sm">{row.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="focus-ring rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground"
                onClick={() => setSheet({ id: row.id, status: "resolved" })}
              >
                {t("admin.onlineLessonIssues.resolve")}
              </button>
              <button
                type="button"
                className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-bold"
                onClick={() => setSheet({ id: row.id, status: "rejected" })}
              >
                {t("admin.onlineLessonIssues.reject")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {sheet ? (
        <AdminReasonSheet
          title={
            sheet.status === "resolved"
              ? t("admin.onlineLessonIssues.resolve")
              : t("admin.onlineLessonIssues.reject")
          }
          description={t("admin.onlineLessonIssues.resolveHint")}
          busy={resolve.isPending}
          onClose={() => setSheet(null)}
          onConfirm={(reason) => {
            resolve.mutate(
              { id: sheet.id, status: sheet.status, adminNotes: reason },
              {
                onSuccess: () => {
                  setSheet(null);
                  toast.success(t("admin.onlineLessonIssues.closed"));
                },
                onError: (e: any) => toast.error(e?.message ?? t("common.error")),
              },
            );
          }}
        />
      ) : null}
    </main>
  );
}