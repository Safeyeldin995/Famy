import { describe, expect, it } from "vitest";
import {
  deriveAdminApprovalDecision,
  documentBlockersFromReview,
  translateAdminOnboardingActionError,
} from "@/lib/admin/providerApprovalReview";

describe("deriveAdminApprovalDecision", () => {
  it("marks complete applications with approved documents as ready to approve", () => {
    const decision = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: { ok: true, complete: true, errors: {} },
      reviewDocuments: [
        { type: "id_card_front", status: "approved" },
        { type: "id_card_back", status: "approved" },
      ],
      isLoading: false,
      isError: false,
    });
    expect(decision.summaryKind).toBe("ready");
    expect(decision.canApprove).toBe(true);
    expect(decision.showApproveAction).toBe(true);
  });

  it("surfaces server completion errors for incomplete applications", () => {
    const decision = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: {
        ok: true,
        complete: false,
        errors: { experience: "experience_incomplete", services: "service_required" },
      },
      reviewDocuments: [
        { type: "id_card_front", status: "approved" },
        { type: "id_card_back", status: "approved" },
      ],
      isLoading: false,
      isError: false,
    });
    expect(decision.summaryKind).toBe("incomplete");
    expect(decision.canApprove).toBe(false);
    expect(decision.completionBlockers).toHaveLength(2);
    expect(decision.approveDisabledReasonKey).toBe(
      "admin.provider.approvalReview.approveBlockedIncomplete",
    );
  });

  it("blocks approval when required documents are pending or rejected", () => {
    const pending = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: { ok: true, complete: true, errors: {} },
      reviewDocuments: [
        { type: "id_card_front", status: "pending" },
        { type: "id_card_back", status: "approved" },
      ],
      isLoading: false,
      isError: false,
    });
    expect(pending.summaryKind).toBe("documents_pending");
    expect(pending.canApprove).toBe(false);

    const rejected = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: { ok: true, complete: true, errors: {} },
      reviewDocuments: [
        { type: "id_card_front", status: "rejected" },
        { type: "id_card_back", status: "approved" },
      ],
      isLoading: false,
      isError: false,
    });
    expect(rejected.summaryKind).toBe("documents_rejected");
    expect(rejected.canApprove).toBe(false);
  });

  it("returns loading and error phases without enabling approval", () => {
    const loading = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: undefined,
      reviewDocuments: [],
      isLoading: true,
      isError: false,
    });
    expect(loading.summaryKind).toBe("loading");
    expect(loading.canApprove).toBe(false);

    const error = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: undefined,
      reviewDocuments: [],
      isLoading: false,
      isError: true,
    });
    expect(error.summaryKind).toBe("error");
    expect(error.canApprove).toBe(false);
  });

  it("shows start review only for submitted applications", () => {
    const submitted = deriveAdminApprovalDecision({
      onboardingStatus: "SUBMITTED",
      completion: { ok: true, complete: false, errors: { personal: "phone_required" } },
      reviewDocuments: [],
      isLoading: false,
      isError: false,
    });
    expect(submitted.canStartReview).toBe(true);
    expect(submitted.showApproveAction).toBe(false);
  });
});

describe("documentBlockersFromReview", () => {
  it("derives missing, pending, and rejected identity document blockers from review rows", () => {
    const { blockers, counts } = documentBlockersFromReview([
      { type: "id_card_front", status: "pending" },
    ]);
    expect(counts.pending).toBe(1);
    expect(counts.missingRequiredTypes).toBe(1);
    expect(blockers.some((b) => b.errorCode === "document_pending_review")).toBe(true);
    expect(blockers.some((b) => b.errorCode === "national_id_required")).toBe(true);
  });
});

describe("translateAdminOnboardingActionError", () => {
  it("maps known server approval failures to translation keys", () => {
    expect(
      translateAdminOnboardingActionError("Application is incomplete and cannot be approved."),
    ).toBe("admin.provider.approvalReview.serverErrors.incomplete");
    expect(
      translateAdminOnboardingActionError(
        "Required identity documents must be approved before provider approval.",
      ),
    ).toBe("admin.provider.approvalReview.serverErrors.documentsNotApproved");
  });

  it("returns null for unknown messages so callers can use a safe fallback", () => {
    expect(translateAdminOnboardingActionError("unexpected internal detail")).toBeNull();
  });
});
