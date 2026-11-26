import { AdminReasonSheet } from "@/components/admin/AdminReasonSheet";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
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
};

type UgcEnriched = UgcRow & {
  messageBody: string | null;
  review: { comment: string | null; rating: number; provider_id: string } | null;
  threadMessages: { body: string }[];
};

type ChatBlockRow = {
  id: string;
  conversation_id: string | null;
  customer_id: string;
  provider_user_id: string;
  blocked_by: string;
  blocked_by_name: string;
  created_at: string;
};

async function fetchAdminChatBlocks(): Promise<ChatBlockRow[]> {
  const { data, error } = await supabase.rpc("admin_list_chat_blocks");
  if (error) throw error;
  return (data ?? []) as ChatBlockRow[];
}

async function fetchOpenUgcReports(): Promise<UgcEnriched[]> {
  const { data, error } = await supabase
    .from("ugc_reports" as never)
    .select(
      "id, subject_type, reason, detail, message_id, conversation_id, review_id, booking_id, reporter_role, reported_by, created_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as UgcRow[];

  return Promise.all(
    rows.map(async (row) => {
      const enriched: UgcEnriched = {
        ...row,
        messageBody: null,
        review: null,
        threadMessages: [],
      };
      if (row.message_id) {
        const { data: msg } = await supabase
          .from("messages")
          .select("body")
          .eq("id", row.message_id)
          .maybeSingle();
        enriched.messageBody = (msg as { body?: string } | null)?.body ?? null;
      }
      if (row.review_id) {
        const { data: review } = await supabase
          .from("reviews")
          .select("comment, rating, provider_id")
          .eq("id", row.review_id)
          .maybeSingle();
        enriched.review = review as UgcEnriched["review"];
      }
      if (row.conversation_id) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("body")
          .eq("conversation_id", row.conversation_id)
          .order("created_at", { ascending: false })
          .limit(5);
        enriched.threadMessages = (msgs ?? []) as { body: string }[];
      }
      return enriched;
    }),
  );
}

export function AdminReportsUgc() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"reports" | "blocks">("reports");
  const [sheet, setSheet] = useState<{
    kind: "resolve" | "dismiss" | "hide_review" | "unblock";
    reportId: string;
    reviewId?: string;
    blockId?: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["admin-ugc-reports"],
    queryFn: fetchOpenUgcReports,
    enabled: tab === "reports",
  });

  const blocksQ = useQuery({
    queryKey: ["admin-chat-blocks"],
    queryFn: fetchAdminChatBlocks,
    enabled: tab === "blocks",
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

  const adminUnblock = useMutation({
    mutationFn: async ({ blockId, notes }: { blockId: string; notes: string }) => {
      const { error } = await supabase.rpc("admin_unblock_chat_block", {
        p_block_id: blockId,
        p_admin_notes: notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("adminOps.actionSuccess"));
      void qc.invalidateQueries({ queryKey: ["admin-chat-blocks"] });
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
      void qc.invalidateQueries({ queryKey: ["admin-ugc-reports"] });
      void qc.invalidateQueries({ queryKey: ["admin-work-queue"] });
      setSheet(null);
    },
    onError: () => toast.error(t("adminOps.actionError")),
  });

  const busy = resolve.isPending || hideReview.isPending || adminUnblock.isPending;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t("admin.reportsUgc.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {tab === "reports" ? t("admin.reportsUgc.subtitle") : t("admin.reportsUgc.blocksSubtitle")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={`focus-ring min-h-11 rounded-xl px-4 text-sm font-bold ${tab === "reports" ? "bg-brand text-brand-foreground" : "border border-border"}`}
          onClick={() => setTab("reports")}
        >
          {t("admin.reportsUgc.tabReports")}
        </button>
        <button
          type="button"
          className={`focus-ring min-h-11 rounded-xl px-4 text-sm font-bold ${tab === "blocks" ? "bg-brand text-brand-foreground" : "border border-border"}`}
          onClick={() => setTab("blocks")}
        >
          {t("admin.reportsUgc.tabBlocks")}
        </button>
      </div>
      {tab === "blocks" ? (
        <>
          {blocksQ.isLoading ? <p className="mt-6">{t("common.loading")}</p> : null}
          {blocksQ.isError ? <p className="mt-6 text-coral">{t("common.error")}</p> : null}
          {!blocksQ.isLoading && !blocksQ.data?.length ? (
            <p className="mt-6 text-muted-foreground">{t("admin.reportsUgc.noBlocks")}</p>
          ) : null}
          <ul className="mt-6 space-y-3">
            {(blocksQ.data ?? []).map((row) => (
              <li key={row.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {t("admin.reportsUgc.blockedBy")}: {row.blocked_by_name || row.blocked_by}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {operationDate(row.created_at, i18n.language)}
                  </span>
                </div>
                <button
                  type="button"
                  className="focus-ring mt-3 min-h-11 rounded-xl border border-border px-4 text-sm font-bold"
                  onClick={() => setSheet({ kind: "unblock", reportId: row.id, blockId: row.id })}
                >
                  {t("admin.reportsUgc.unblock")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {tab === "reports" && q.isLoading ? <p className="mt-6">{t("common.loading")}</p> : null}
      {tab === "reports" && q.isError ? <p className="mt-6 text-coral">{t("common.error")}</p> : null}
      {tab === "reports" && !q.isLoading && !q.data?.length ? (
        <p className="mt-6 text-muted-foreground">{t("admin.reportsUgc.noOpen")}</p>
      ) : null}
      {tab === "reports" ? (
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
              {t("admin.reportsUgc.reporter")}:{" "}
              {t(`admin.reportsUgc.roles.${row.reporter_role}`, { defaultValue: row.reporter_role })}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {row.booking_id ? (
                <Link
                  to="/admin/bookings"
                  search={{ booking: row.booking_id }}
                  className="font-semibold text-brand hover:underline"
                >
                  {t("admin.reportsUgc.viewBooking")}
                </Link>
              ) : null}
              {row.review?.provider_id ? (
                <Link
                  to="/admin/provider/$id"
                  params={{ id: row.review.provider_id }}
                  className="font-semibold text-brand hover:underline"
                >
                  {t("admin.reportsUgc.viewProvider")}
                </Link>
              ) : null}
            </div>
            {row.detail ? (
              <p className="mt-2 text-sm">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("admin.reportsUgc.detail")}:{" "}
                </span>
                {row.detail}
              </p>
            ) : null}
            {row.messageBody ? (
              <p className="mt-2 rounded-lg bg-muted/40 p-2 text-sm">{row.messageBody}</p>
            ) : null}
            {row.review ? (
              <p className="mt-2 rounded-lg bg-muted/40 p-2 text-sm">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("admin.reportsUgc.reviewExcerpt")} ({row.review.rating}/5):{" "}
                </span>
                {row.review.comment || t("admin.reportsUgc.emptyReviewComment")}
              </p>
            ) : null}
            {row.threadMessages.length ? (
              <div className="mt-2 space-y-1 rounded-lg bg-muted/40 p-2 text-sm">
                <p className="text-xs font-semibold text-muted-foreground">
                  {t("admin.reportsUgc.threadExcerpt")}
                </p>
                {row.threadMessages.map((msg, i) => (
                  <p key={`${row.id}-msg-${i}`}>{msg.body}</p>
                ))}
              </div>
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
      ) : null}
      {sheet ? (
        <AdminReasonSheet
          title={
            sheet.kind === "hide_review"
              ? t("admin.reportsUgc.hideReview")
              : sheet.kind === "unblock"
                ? t("admin.reportsUgc.unblock")
              : sheet.kind === "resolve"
                ? t("admin.reportsUgc.resolve")
                : t("admin.reportsUgc.dismiss")
          }
          description={
            sheet.kind === "hide_review"
              ? t("admin.reportsUgc.hideReviewNotes")
              : sheet.kind === "unblock"
                ? t("admin.reportsUgc.unblockNotes")
              : t("admin.reportsUgc.notesPlaceholder")
          }
          busy={busy}
          onClose={() => (!busy ? setSheet(null) : undefined)}
          onConfirm={(notes) => {
            if (sheet.kind === "unblock" && sheet.blockId) {
              adminUnblock.mutate({ blockId: sheet.blockId, notes });
              return;
            }
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