import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { operationDate } from "@/components/admin/operations";

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
  const q = useQuery({
    queryKey: ["admin-online-lesson-issues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("online_lesson_issue_reports" as never)
        .select("id, booking_id, category, priority, minor_involved, reporter_role, description, created_at")
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
      {q.isError ? <p className="mt-6 text-coral">{t("common.error")}</p> : null}
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
              {t("admin.onlineLessonIssues.booking")} {row.booking_id.slice(0, 8)} ·{" "}
              {t(`admin.onlineLessonIssues.roles.${row.reporter_role}`)}
              {row.priority === "high" ? ` · ${t("admin.onlineLessonIssues.highPriority")}` : ""}
            </p>
            <p className="mt-2 text-sm">{row.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}