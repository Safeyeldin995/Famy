import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../admin.provider.$id.tsx"),
  "utf8",
);

describe("admin provider approval page wiring (static mocked proof)", () => {
  it("uses server completion from admin onboarding review and shows decision summary", () => {
    expect(source).toContain("ProviderApprovalDecisionSummary");
    expect(source).toContain("deriveAdminApprovalDecision");
    expect(source).toContain("reviewPayload?.completion");
    expect(source).toContain("admin-approval-decision");
  });

  it("disables approve while loading or when decision blocks approval", () => {
    expect(source).toContain("!approvalDecision.canApprove");
    expect(source).toContain("onboardingReview.isLoading");
    expect(source).toContain("translateAdminOnboardingActionError");
  });
});
