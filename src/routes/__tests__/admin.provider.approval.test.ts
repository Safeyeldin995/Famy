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
  it("routes onboarding action errors through formatAdminActionErrorMessage", () => {
    expect(source).toContain("formatAdminActionErrorMessage(t, e)");
    expect(source).not.toContain("adminActionErrorMessage");
    expect(source).toMatch(
      /action: "approve"[\s\S]*?onError: \(e\) => toast\.error\(formatAdminActionErrorMessage\(t, e\)\)/,
    );
  });

  it("routes document review errors through the same toast formatter", () => {
    expect(source).toMatch(
      /reviewDocument\.mutate\([\s\S]*?onError: \(e\) =>\s*toast\.error\(formatAdminActionErrorMessage\(t, e\)\)/,
    );
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
