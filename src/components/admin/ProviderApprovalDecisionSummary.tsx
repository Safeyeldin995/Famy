import { AlertCircle, CheckCircle2, FileWarning, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type AdminApprovalDecision,
  onboardingCompletionErrorKey,
} from "@/lib/admin/providerApprovalReview";
export function ProviderApprovalDecisionSummary({
  decision,
}: {
  decision: AdminApprovalDecision;
}) {
  const { t } = useTranslation();
  const status = decision.onboardingStatus;

  const statusLabel =
    status && typeof status === "string"
      ? t(`pro.onboardingWizard.status.${status}`, status)
      : t("admin.provider.approvalReview.statusUnknown");

  const summaryTitle = (() => {
    switch (decision.summaryKind) {
      case "loading":
        return t("admin.provider.approvalReview.summaryLoading");
      case "error":
        return t("admin.provider.approvalReview.summaryError");
      case "ready":
        return t("admin.provider.approvalReview.summaryReady");
      case "incomplete":
        return t("admin.provider.approvalReview.summaryIncomplete");
      case "documents_pending":
        return t("admin.provider.approvalReview.summaryDocumentsPending");
      case "documents_rejected":
        return t("admin.provider.approvalReview.summaryDocumentsRejected");
      case "documents_missing":
        return t("admin.provider.approvalReview.summaryDocumentsMissing");
      case "not_in_review":
        return t("admin.provider.approvalReview.summaryNotInReview");
      default:
        return t("admin.provider.approvalReview.summaryNotInReview");
    }
  })();

  const toneClass =
    decision.summaryKind === "ready"
      ? "border-success/30 bg-mint/10"
      : decision.summaryKind === "loading"
        ? "border-border/60 bg-surface"
        : decision.summaryKind === "error"
          ? "border-coral/30 bg-coral/5"
          : "border-amber-300/40 bg-amber-50/80 dark:bg-amber-950/20";

  const Icon =
    decision.summaryKind === "ready"
      ? CheckCircle2
      : decision.summaryKind === "loading"
        ? Loader2
        : AlertCircle;

  const blockers = [...decision.completionBlockers, ...decision.documentBlockers];

  return (
    <section
      id="admin-approval-decision"
      aria-live="polite"
      className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${decision.summaryKind === "loading" ? "animate-spin text-muted-foreground" : decision.summaryKind === "ready" ? "text-success" : "text-amber-700 dark:text-amber-300"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-extrabold">{summaryTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("admin.provider.approvalReview.currentStatus", { status: statusLabel })}
            </p>
          </div>

          {decision.summaryKind === "ready" && decision.phase === "review" && (
            <p className="text-xs font-semibold text-success">
              {t("admin.provider.approvalReview.readyBody")}
            </p>
          )}

          {blockers.length > 0 && decision.phase === "review" && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("admin.provider.approvalReview.blockersTitle")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("admin.provider.approvalReview.blockersNote")}
              </p>
              <ul className="space-y-2">
                {blockers.map((blocker) => {
                  const sectionLabel = t(
                    `admin.provider.approvalReview.sections.${blocker.sectionKey}`,
                    blocker.sectionKey,
                  );
                  const message =
                    blocker.kind === "document" && blocker.documentType
                      ? t(`admin.provider.approvalReview.documentErrors.${blocker.errorCode}`, {
                          document: t(
                            `admin.provider.approvalReview.documentTypes.${blocker.documentType}`,
                            blocker.documentType,
                          ),
                        })
                      : (() => {
                          const errorKey = onboardingCompletionErrorKey(blocker.errorCode);
                          const translated = t(errorKey);
                          return translated === errorKey
                            ? t("admin.provider.approvalReview.unknownErrorCode", {
                                code: blocker.errorCode,
                              })
                            : translated;
                        })();
                  const label = `${sectionLabel}: ${message}`;
                  return (
                    <li key={blocker.id} className="text-xs font-semibold">
                      {blocker.href ? (
                        <a href={blocker.href} className="text-brand underline underline-offset-2">
                          {label}
                        </a>
                      ) : (
                        <span>{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {decision.approveDisabledReasonKey && (
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              {t(decision.approveDisabledReasonKey)}
            </p>
          )}

          {decision.documentCounts.pending > 0 && decision.phase === "review" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileWarning className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("admin.provider.approvalReview.documentsPendingCount", {
                count: decision.documentCounts.pending,
              })}
            </p>
          )}

          {decision.summaryKind === "error" && (
            <p className="text-xs text-coral">{t("admin.provider.approvalReview.loadError")}</p>
          )}

          {decision.phase === "idle" && status === "APPROVED" && (
            <p className="text-xs text-muted-foreground">
              {t("admin.provider.approvalReview.approvedHint")}{" "}
              <a href="#marketplace-eligibility" className="font-semibold text-brand underline">
                {t("admin.provider.eligibilityTitle")}
              </a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
