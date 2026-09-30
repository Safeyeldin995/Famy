import type { TFunction } from "i18next";
import type { OnboardingStatus } from "@/lib/provider/onboarding-queries";

export type OnboardingCompletionPayload = {
  ok?: boolean;
  complete?: boolean;
  errors?: Record<string, string>;
  error?: string;
};

export type ReviewDocumentRow = {
  id?: string;
  type?: string;
  status?: string;
};

export type AdminApprovalBlocker = {
  id: string;
  kind: "completion" | "document";
  sectionKey: string;
  errorCode: string;
  documentType?: string;
  href?: string;
};

export type AdminApprovalDecision = {
  phase: "loading" | "error" | "idle" | "review";
  onboardingStatus: OnboardingStatus | string | null | undefined;
  completionComplete: boolean;
  approvalReady: boolean;
  canStartReview: boolean;
  showApproveAction: boolean;
  canApprove: boolean;
  canRequestChanges: boolean;
  canRejectApplication: boolean;
  summaryKind:
    | "loading"
    | "error"
    | "ready"
    | "incomplete"
    | "documents_pending"
    | "documents_rejected"
    | "documents_missing"
    | "not_in_review";
  completionBlockers: AdminApprovalBlocker[];
  documentBlockers: AdminApprovalBlocker[];
  documentCounts: { pending: number; rejected: number; missingRequiredTypes: number };
  approveDisabledReasonKey: string | null;
};

const REQUIRED_ID_DOCUMENT_TYPES = ["id_card_front", "id_card_back"] as const;

export const COMPLETION_SECTION_HREFS: Record<string, string> = {
  personal: "#admin-onboarding-details",
  experience: "#admin-onboarding-details",
  services: "#admin-provider-services",
  coverage: "#admin-onboarding-details",
  references: "#admin-onboarding-details",
  documents: "#admin-provider-documents",
  review: "#admin-onboarding-details",
};

export function onboardingCompletionErrorKey(errorCode: string): string {
  return `pro.onboardingWizard.errors.${errorCode}`;
}

const ADMIN_ACTION_ERROR_RULES: Array<{ pattern: RegExp; key: string }> = [
  {
    pattern: /Application is incomplete and cannot be approved/i,
    key: "admin.provider.approvalReview.serverErrors.incomplete",
  },
  {
    pattern: /Required identity documents must be approved/i,
    key: "admin.provider.approvalReview.serverErrors.documentsNotApproved",
  },
  {
    pattern: /Rejected required documents must be replaced/i,
    key: "admin.provider.approvalReview.serverErrors.documentsRejected",
  },
  {
    pattern: /Only submitted applications can enter review/i,
    key: "admin.provider.approvalReview.serverErrors.startReviewInvalid",
  },
  {
    pattern: /Only submitted or in-review applications can be approved/i,
    key: "admin.provider.approvalReview.serverErrors.approveInvalidStatus",
  },
  {
    pattern: /A reason is required to reject a document/i,
    key: "admin.provider.approvalReview.serverErrors.documentRejectReasonRequired",
  },
  {
    pattern: /Document not found/i,
    key: "admin.provider.approvalReview.serverErrors.documentNotFound",
  },
  {
    pattern: /Invalid document review status/i,
    key: "admin.provider.approvalReview.serverErrors.documentReviewInvalid",
  },
  {
    pattern: /Admin authorization required/i,
    key: "admin.provider.approvalReview.serverErrors.adminAuthRequired",
  },
];

/** Safely read a user-facing message from Error instances or PostgREST-style objects. */
export function extractAdminActionErrorText(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (error instanceof Error) {
    const trimmed = error.message?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const field of ["message", "error_description", "msg"] as const) {
      const value = record[field];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return null;
}

export function translateAdminActionError(message: string | undefined | null): string | null {
  if (!message) return null;
  const normalized = message.trim();
  return ADMIN_ACTION_ERROR_RULES.find((rule) => rule.pattern.test(normalized))?.key ?? null;
}

/** @deprecated Use translateAdminActionError */
export const translateAdminOnboardingActionError = translateAdminActionError;

/** Toast copy for admin onboarding/document actions (matches admin.provider.$id onError). */
export function formatAdminActionErrorMessage(
  t: TFunction,
  error: unknown,
  fallbackKey = "admin.provider.approvalReview.serverErrors.fallback",
): string {
  const text = extractAdminActionErrorText(error);
  const key = translateAdminActionError(text);
  return String(key ? t(key) : t(fallbackKey));
}

export function formatOnboardingStatusLabel(
  t: TFunction,
  status: string | null | undefined,
): string {
  if (!status) return String(t("admin.provider.approvalReview.statusUnknown"));
  return String(t(`pro.onboardingWizard.status.${status}`, status));
}

export function formatAdminAuditEventLine(
  t: TFunction,
  event: { action?: string; previous_status?: string; new_status?: string },
): string {
  const actionLabel = event.action
    ? String(t(`admin.provider.approvalReview.auditActions.${event.action}`, event.action))
    : String(t("admin.provider.approvalReview.statusUnknown"));
  const from = formatOnboardingStatusLabel(t, event.previous_status);
  const to = formatOnboardingStatusLabel(t, event.new_status);
  return `${actionLabel} · ${from} → ${to}`;
}

function completionBlockersFromPayload(
  completion: OnboardingCompletionPayload | null | undefined,
): AdminApprovalBlocker[] {
  const errors = completion?.errors ?? {};
  return Object.entries(errors).map(([sectionKey, errorCode]) => ({
    id: `completion:${sectionKey}:${errorCode}`,
    kind: "completion" as const,
    sectionKey,
    errorCode,
    href: COMPLETION_SECTION_HREFS[sectionKey],
  }));
}

export function documentBlockersFromReview(
  documents: ReviewDocumentRow[] | null | undefined,
): { blockers: AdminApprovalBlocker[]; counts: AdminApprovalDecision["documentCounts"] } {
  const rows = documents ?? [];
  const blockers: AdminApprovalBlocker[] = [];
  let pending = 0;
  let rejected = 0;
  let missingRequiredTypes = 0;

  for (const docType of REQUIRED_ID_DOCUMENT_TYPES) {
    const ofType = rows.filter((row) => row.type === docType);
    if (ofType.length === 0) {
      missingRequiredTypes += 1;
      blockers.push({
        id: `document:missing:${docType}`,
        kind: "document",
        sectionKey: "documents",
        errorCode: "national_id_required",
        documentType: docType,
        href: "#admin-provider-documents",
      });
      continue;
    }
    if (ofType.some((row) => row.status === "rejected")) {
      rejected += 1;
      blockers.push({
        id: `document:rejected:${docType}`,
        kind: "document",
        sectionKey: "documents",
        errorCode: "document_rejected",
        documentType: docType,
        href: "#admin-provider-documents",
      });
      continue;
    }
    if (!ofType.some((row) => row.status === "approved")) {
      pending += 1;
      blockers.push({
        id: `document:pending:${docType}`,
        kind: "document",
        sectionKey: "documents",
        errorCode: "document_pending_review",
        documentType: docType,
        href: "#admin-provider-documents",
      });
    }
  }

  return {
    blockers,
    counts: { pending, rejected, missingRequiredTypes },
  };
}

export function deriveAdminApprovalDecision(input: {
  onboardingStatus: OnboardingStatus | string | null | undefined;
  completion: OnboardingCompletionPayload | null | undefined;
  reviewDocuments: ReviewDocumentRow[] | null | undefined;
  isLoading: boolean;
  isError: boolean;
}): AdminApprovalDecision {
  const status = input.onboardingStatus ?? null;
  const completionBlockers = completionBlockersFromPayload(input.completion);
  const completionComplete = Boolean(input.completion?.complete);
  const { blockers: documentBlockers, counts: documentCounts } = documentBlockersFromReview(
    input.reviewDocuments,
  );
  const documentsReady = documentBlockers.length === 0;

  const inReviewFlow = status === "SUBMITTED" || status === "UNDER_REVIEW";
  const canStartReview = status === "SUBMITTED";
  const showApproveAction = status === "UNDER_REVIEW";
  const canApprove = showApproveAction && completionComplete && documentsReady;
  const canRequestChanges = status === "UNDER_REVIEW";
  const canRejectApplication = inReviewFlow;

  if (input.isLoading) {
    return {
      phase: "loading",
      onboardingStatus: status,
      completionComplete: false,
      approvalReady: false,
      canStartReview,
      showApproveAction,
      canApprove: false,
      canRequestChanges,
      canRejectApplication,
      summaryKind: "loading",
      completionBlockers: [],
      documentBlockers: [],
      documentCounts,
      approveDisabledReasonKey: "admin.provider.approvalReview.loading",
    };
  }

  if (input.isError) {
    return {
      phase: "error",
      onboardingStatus: status,
      completionComplete: false,
      approvalReady: false,
      canStartReview,
      showApproveAction,
      canApprove: false,
      canRequestChanges,
      canRejectApplication,
      summaryKind: "error",
      completionBlockers: [],
      documentBlockers: [],
      documentCounts,
      approveDisabledReasonKey: "admin.provider.approvalReview.loadError",
    };
  }

  if (!inReviewFlow) {
    return {
      phase: "idle",
      onboardingStatus: status,
      completionComplete,
      approvalReady: false,
      canStartReview: false,
      showApproveAction: false,
      canApprove: false,
      canRequestChanges: false,
      canRejectApplication: false,
      summaryKind: "not_in_review",
      completionBlockers,
      documentBlockers,
      documentCounts,
      approveDisabledReasonKey: null,
    };
  }

  let summaryKind: AdminApprovalDecision["summaryKind"] = "ready";
  if (!completionComplete) summaryKind = "incomplete";
  else if (documentCounts.rejected > 0) summaryKind = "documents_rejected";
  else if (documentCounts.pending > 0) summaryKind = "documents_pending";
  else if (documentCounts.missingRequiredTypes > 0) summaryKind = "documents_missing";

  let approveDisabledReasonKey: string | null = null;
  if (status === "UNDER_REVIEW") {
    if (!completionComplete) {
      approveDisabledReasonKey = "admin.provider.approvalReview.approveBlockedIncomplete";
    } else if (!documentsReady) {
      approveDisabledReasonKey = "admin.provider.approvalReview.approveBlockedDocuments";
    }
  }

  return {
    phase: "review",
    onboardingStatus: status,
    completionComplete,
    approvalReady: completionComplete && documentsReady,
    canStartReview,
    showApproveAction,
    canApprove,
    canRequestChanges,
    canRejectApplication,
    summaryKind,
    completionBlockers,
    documentBlockers,
    documentCounts,
    approveDisabledReasonKey,
  };
}
