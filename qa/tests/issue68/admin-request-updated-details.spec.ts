import { test, expect } from "@playwright/test";
import { installIssue68Mocks } from "./mock-supabase.mjs";
import { MOCK_PROVIDER_ID } from "../../issue68-host/constants.mjs";

test.describe("admin request updated details dialog", () => {
  test("requires a provider-visible reason and submits the audited payload", async ({ page }) => {
    const mocks = await installIssue68Mocks(page);
    await page.goto("/admin-updated-details");
    await expect(page.getByTestId("onboarding-status")).toHaveText("APPROVED");

    const before = await mocks.getCalls();
    expect(before.adminReviews).toBeGreaterThanOrEqual(1);
    expect(before.lastAdminReview?.provider?.onboarding_status).toBe("APPROVED");

    const open = page.getByRole("button", { name: "Request updated details" });
    await expect(open).toBeVisible();
    await open.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/provider-visible reason/i)).toBeVisible();
    await expect(dialog.getByText(/customer-visible/i)).toHaveCount(0);

    const confirm = dialog.getByRole("button", { name: "Request details" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Reason (required)").fill("Need babysitting age-group declaration");
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect
      .poll(async () => (await mocks.getCalls()).adminActions?.length ?? 0)
      .toBeGreaterThan(0);

    const payload = (await mocks.getCalls()).adminActions[0];
    expect(payload).toMatchObject({
      p_provider_id: MOCK_PROVIDER_ID,
      p_action: "request_updated_details",
      p_reason_code: "updated_details_required",
      p_reason_public: "Need babysitting age-group declaration",
    });

    await expect
      .poll(async () => {
        const calls = await mocks.getCalls();
        return (
          calls.adminReviews >= before.adminReviews + 1 &&
          calls.lastAdminReview?.provider?.onboarding_status === "NEEDS_CHANGES" &&
          calls.adminProviderStatus === "NEEDS_CHANGES"
        );
      })
      .toBe(true);

    await expect(page.getByTestId("onboarding-status")).toHaveText("NEEDS_CHANGES");
    await expect(page.getByRole("button", { name: "Request updated details" })).toHaveCount(0);
    await mocks.assertIsolated();
  });
});
