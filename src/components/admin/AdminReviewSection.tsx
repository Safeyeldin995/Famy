import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminReviewSection,
  useAdminSectionReviews,
  type AdminReviewSection as SectionKey,
} from "@/lib/db/admin-section-reviews";

export function AdminReviewSection({
  providerId,
  section,
  title,
  canReview,
  submittedAt,
  children,
}: {
  providerId: string;
  section: SectionKey;
  title: string;
  canReview: boolean;
  submittedAt?: string | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const reviews = useAdminSectionReviews(providerId);
  const mutate = useAdminReviewSection();
  const [pendingDecision, setPendingDecision] = useState<"request_changes" | "rejected" | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const recorded = reviews.data?.find((row) => row.section === section);
  const current =
    recorded && (!submittedAt || new Date(recorded.reviewed_at) >= new Date(submittedAt))
      ? recorded
      : null;
  const actionDisabled = !canReview || reviews.isLoading || reviews.isError || mutate.isPending;

  const save = (decision: "approved" | "request_changes" | "rejected") => {
    mutate.mutate(
      { providerId, section, decision, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          setPendingDecision(null);
          setReason("");
        },
        onError: () => toast.error(t("adminReview.sectionSaveError")),
      },
    );
  };

  return (
    <section
      id={`admin-review-${section}`}
      className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-extrabold">{title}</h2>
        {current?.decision === "approved" && (
          <span className="rounded-full bg-mint/20 px-3 py-1 text-xs font-bold text-success">
            {t("adminReview.sectionChecked")}
          </span>
        )}
      </div>
      <div className="mt-3 min-w-0 space-y-3 text-sm">{children}</div>
      {canReview && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs text-muted-foreground">
            {t("adminReview.sectionApproveHint")}
          </p>
          {reviews.isError && (
            <p className="mb-2 text-xs text-coral">{t("adminReview.approveAllUnavailable")}</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => save("approved")}
              className="focus-ring min-h-11 rounded-xl bg-brand px-3 py-2 text-sm font-bold text-brand-foreground disabled:opacity-50"
            >
              {t("adminReview.approve")}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                setPendingDecision("request_changes");
                setReason("");
              }}
              className="focus-ring min-h-11 rounded-xl border border-border px-3 py-2 text-sm font-bold disabled:opacity-50"
            >
              {t("adminReview.requestChanges")}
            </button>
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                setPendingDecision("rejected");
                setReason("");
              }}
              className="focus-ring min-h-11 rounded-xl border border-coral px-3 py-2 text-sm font-bold text-coral disabled:opacity-50"
            >
              {t("adminReview.reject")}
            </button>
          </div>
          {pendingDecision && (
            <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm font-semibold text-coral">
                {t("adminReview.sectionGlobalEffect")}
              </p>
              <label className="block text-sm font-semibold" htmlFor={`reason-${section}`}>
                {t("adminReview.reason")}
              </label>
              <textarea
                id={`reason-${section}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-border bg-surface p-3 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!reason.trim() || mutate.isPending}
                  onClick={() => save(pendingDecision)}
                  className="focus-ring min-h-11 flex-1 rounded-xl bg-brand px-3 text-sm font-bold text-brand-foreground disabled:opacity-50"
                >
                  {t("common.confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDecision(null)}
                  className="focus-ring min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-bold"
                >
                  {t("adminReview.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
