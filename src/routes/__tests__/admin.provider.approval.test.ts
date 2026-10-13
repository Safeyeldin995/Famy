import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { formatAdminActionErrorMessage } from "@/lib/admin/providerApprovalReview";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../admin.provider.$id.tsx"),
  "utf8",
);

const POSTGREST_INCOMPLETE_APPROVE_ERROR = {
  message: "Application is incomplete and cannot be approved.",
  code: "23514",
  details: null,
  hint: null,
};

describe("admin provider approval page (mocked)", () => {
  it("uses the atomic approve-all RPC path instead of approving onboarding alone", () => {
    expect(source).toContain("useApproveProviderApplicationAll");
    expect(source).toContain("approveAll.mutate(id");
    expect(source).not.toMatch(/action: "approve"/);
  });

  it("keeps document review errors on the translated toast formatter", () => {
    expect(source).toContain("formatAdminActionErrorMessage(t, error)");
    expect(source).toContain("documentId: document.id");
  });

  it("produces translated toast text from PostgREST approve rejection (UI error path)", async () => {
    await i18n.changeLanguage("en");
    const toastMessage = formatAdminActionErrorMessage(
      i18n.t.bind(i18n),
      POSTGREST_INCOMPLETE_APPROVE_ERROR,
    );
    expect(toastMessage).toBe("Application is incomplete and cannot be approved.");
    expect(toastMessage).not.toContain("[object Object]");
  });
});
