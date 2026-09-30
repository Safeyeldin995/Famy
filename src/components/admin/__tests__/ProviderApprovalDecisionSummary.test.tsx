import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { ProviderApprovalDecisionSummary } from "@/components/admin/ProviderApprovalDecisionSummary";
import { deriveAdminApprovalDecision } from "@/lib/admin/providerApprovalReview";

function renderSummary(decision: ReturnType<typeof deriveAdminApprovalDecision>) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ProviderApprovalDecisionSummary decision={decision} />
    </I18nextProvider>,
  );
}

describe("ProviderApprovalDecisionSummary (mocked markup)", () => {
  it("renders English ready state and applicable approve action context", async () => {
    await i18n.changeLanguage("en");
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
    const html = renderSummary(decision);
    expect(html).toContain("Ready for approval");
    expect(html).toContain("Application status:");
  });

  it("renders Arabic incomplete blockers from server completion payload", async () => {
    await i18n.changeLanguage("ar");
    const decision = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: {
        ok: true,
        complete: false,
        errors: { experience: "experience_incomplete" },
      },
      reviewDocuments: [
        { type: "id_card_front", status: "approved" },
        { type: "id_card_back", status: "approved" },
      ],
      isLoading: false,
      isError: false,
    });
    const html = renderSummary(decision);
    expect(html).toContain("معلومات ناقصة");
    expect(html).toContain("أكمل معلومات الخبرة");
    expect(html).toContain("قيد المراجعة");
    await i18n.changeLanguage("en");
  });

  it("renders loading summary without throwing", async () => {
    await i18n.changeLanguage("en");
    const decision = deriveAdminApprovalDecision({
      onboardingStatus: "UNDER_REVIEW",
      completion: undefined,
      reviewDocuments: [],
      isLoading: true,
      isError: false,
    });
    const html = renderSummary(decision);
    expect(html).toContain("Checking whether this application can be approved");
  });
});
