import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { operationDate } from "@/components/admin/operations";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/reports-ugc")({ component: AdminReportsUgc });

type UgcRow = {
  id: string;
  subject_type: string;
  reason: string;
  detail: string | null;
  message_id: string | null;
  conversation_id: string | null;
  review_id: string | null;
  booking_id: string | null;
  reporter_role: string;
  reported_by: string;
  created_at: string;
  messages?: { body: string } | null;
};

export function AdminReportsUgc() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<{
    kind: "resolve" | "dismiss" | "hide_review";
    reportId: string;
    reviewId?: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["admin-ugc-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ugc_reports" as never)
        .select(
          "id, subject_type, reason, detail, message_id, conversation_id, review_id, booking_id, reporter_role, reported_by, created_at, messages:messages(body)",
        )
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as UgcRow[];
    },
  });

  const resolve = useMutation({
    mutationFn: async ({
      reportId,
      status,
      notes,
    }: {
      reportId: string;
      status: "resolved" | "dismissed";
      notes: string;
    }) => {
      const { error } = await supabase.rpc("admin_resolve_ugc_report", {
        p_report_id: reportId,
        p_status: status,
        p_admin_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("adminOps.actionSuccess"));
      void qc.invalidateQueries({ queryKey: ["admin-ugc-reports"] });
      void qc.invalidateQueries({ queryKey: ["admin-work-queue"] });
      setSheet(null);
    },
    onError: () => toast.error(t("adminOps.actionError")),
  });

  const hideReview = useMutation({
    mutationFn: async ({ reviewId, notes }: { reviewId: string; notes: string }) => {
      const { error } = await supabase.rpc("admin_hide_ugc_review", {
        p_review_id: reviewId,
        p_admin_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("adminOps.actionSuccess"));
      setSheet(null);
    },
    onError: () => toast.error(t("adminOps.actionError")),
  });

  const busy = resolve.isPending || hideReview.isPending;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t("admin.reportsUgc.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("admin.reportsUgc.subtitle")}</p>
      {q.isLoading ? <p className="mt-6">{t("common.loading")}</p> : null}
      {q.isError ? <p className="mt-6 text-coral">{t("common.error")}</p> : null}
      {!q.isLoading && !q.data?.length ? (
        <p className="mt-6 text-muted-foreground">{t("admin.reportsUgc.noOpen")}</p>
      ) : null}
      <ul className="mt-6 space-y-3">
        {(q.data ?? []).map((row) => (
          <li key={row.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {t(`admin.reportsUgc.subjectTypes.${row.subject_type}`)} ·{" "}
                {t(`admin.reportsUgc.reasons.${row.reason}`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {operationDate(row.created_at, i18n.language)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("admin.reportsUgc.reporter")}: {t(`admin.reportsUgc.roles.${row.reporter_role}`, { defaultValue: row.reporter_role })}
              {row.booking_id ? ` · ${t("admin.reportsUgc.booking")} ${row.booking_id.slice(0, 8)}` : ""}
            </p>
            {row.detail ? <p className="mt-2 text-sm">{row.detail}</p> : null}
            {row.messages?.body ? (
              <p className="mt-2 rounded-lg bg-muted/40 p-2 text-sm">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("admin.reportsUgc.messagePreview")}:{" "}
                </span>
                {row.messages.body}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="focus-ring min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground"
                onClick={() => setSheet({ kind: "resolve", reportId: row.id })}
              >
                {t("admin.reportsUgc.resolve")}
              </button>
              <button
                type="button"
                className="focus-ring min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
                onClick={() => setSheet({ kind: "dismiss", reportId: row.id })}
              >
                {t("admin.reportsUgc.dismiss")}
              </button>
              {row.review_id ? (
                <button
                  type="button"
                  className="focus-ring min-h-11 rounded-xl border border-coral/40 px-4 text-sm font-bold text-coral"
                  onClick={() =>
                    setSheet({ kind: "hide_review", reportId: row.id, reviewId: row.review_id! })
                  }
                >
                  {t("admin.reportsUgc.hideReview")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {sheet ? (
        <AdminReasonSheet
          title={
            sheet.kind === "hide_review"
              ? t("admin.reportsUgc.hideReview")
              : sheet.kind === "resolve"
                ? t("admin.reportsUgc.resolve")
                : t("admin.reportsUgc.dismiss")
          }
          description={
            sheet.kind === "hide_review"
              ? t("admin.reportsUgc.hideReviewNotes")
              : t("admin.reportsUgc.notesPlaceholder")
          }
          busy={busy}
          onClose={() => (!busy ? setSheet(null) : undefined)}
          onConfirm={(notes) => {
            if (sheet.kind === "hide_review" && sheet.reviewId) {
              hideReview.mutate({ reviewId: sheet.reviewId, notes });
              return;
            }
            resolve.mutate({
              reportId: sheet.reportId,
              status: sheet.kind === "resolve" ? "resolved" : "dismissed",
              notes,
            });
          }}
        />
      ) : null}
    </main>
  );
}