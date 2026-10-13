import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useAdminReviewSection,
  useAdminSectionReviews,
  type AdminReviewSection as SectionKey,
} from "@/lib/db/admin-section-reviews";
import { AdminReasonSheet } from "./AdminReasonSheet";
import { formatAdminActionErrorMessage } from "@/lib/admin/providerApprovalReview";

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
  const [requestingChanges, setRequestingChanges] = useState(false);
  const recorded = reviews.data?.find((row) => row.section === section);
  const checked =
    recorded?.decision === "approved" &&
    (!submittedAt || new Date(recorded.reviewed_at) >= new Date(submittedAt));
  const disabled = !canReview || reviews.isLoading || reviews.isError || mutate.isPending;
  const save = (decision: "approved" | "clear" | "request_changes", reason?: string) => {
    mutate.mutate(
      { providerId, section, decision, reason },
      {
        onSuccess: () => setRequestingChanges(false),
        onError: (error) =>
          toast.error(formatAdminActionErrorMessage(t, error, "adminReview.sectionSaveError")),
      },
    );
  };
  return (
    <section
      id={`admin-review-${section}`}
      className="min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-sm"
    >
      <h2 className="text-base font-extrabold">{title}</h2>
      <div className="mt-3 min-w-0 space-y-3 text-sm">{children}</div>
      {canReview && (
        <div className="mt-3 border-t border-border pt-2">
          {reviews.isError && (
            <p className="text-xs text-coral">{t("adminReview.approveAllUnavailable")}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-pressed={Boolean(checked)}
              disabled={disabled}
              onClick={() => save(checked ? "clear" : "approved")}
              className={`focus-ring min-h-11 rounded-full px-3 text-sm font-bold disabled:opacity-50 ${checked ? "bg-mint/20 text-success" : "border border-border text-muted-foreground"}`}
            >
              {t("adminReview.checkedChip")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRequestingChanges(true)}
              className="focus-ring min-h-11 rounded-lg px-2 text-sm font-semibold text-brand underline-offset-4 hover:underline disabled:opacity-50"
            >
              {t("adminReview.requestChanges")}
            </button>
          </div>
        </div>
      )}
      {requestingChanges && (
        <AdminReasonSheet
          title={`${t("adminReview.requestChanges")} · ${title}`}
          description={t("adminReview.sectionGlobalEffect")}
          busy={mutate.isPending}
          onClose={() => setRequestingChanges(false)}
          onConfirm={(reason) => save("request_changes", reason)}
        />
      )}
    </section>
  );
}
