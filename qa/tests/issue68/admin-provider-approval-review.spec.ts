import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { installIssue68Mocks } from "./mock-supabase.mjs";

const SCREENSHOT_DIR = path.join(process.cwd(), "qa-artifacts", "pr82-admin-approval-browser");

const VIEWPORTS = [
  { width: 360, height: 740, name: "360" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1280, height: 900, name: "1280" },
] as const;

type HarnessOptions = Parameters<typeof installIssue68Mocks>[1];

async function assertNoHorizontalOverflow(page: Page) {
  const overflows = await page.evaluate(() => {
    const doc = document.documentElement;
    const bodyOverflow = document.body.scrollWidth > document.body.clientWidth + 1;
    const docOverflow = doc.scrollWidth > doc.clientWidth + 1;
    return bodyOverflow || docOverflow;
  });
  expect(overflows).toBe(false);
}

async function openAdminProviderReview(page: Page, options: HarnessOptions = {}) {
  await installIssue68Mocks(page, options);
  await page.goto("/admin-provider-review");
  await expect(page.getByTestId("issue68-admin-provider-review")).toBeVisible();
}

async function waitForDecisionLoaded(page: Page) {
  await expect(page.locator("#admin-approval-decision")).toBeVisible();
  await expect(page.locator("#admin-approval-decision .animate-spin")).toHaveCount(0, {
    timeout: 20_000,
  });
}

test.describe("PR #82 admin provider approval review (issue68 mocked browser)", () => {
  test.beforeAll(() => {
    // eslint-disable-next-line no-empty
  });

  test("1 — complete + approved documents: ready summary and enabled Approve (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "ready" });
    await waitForDecisionLoaded(page);
    await expect(page.getByRole("heading", { name: "Ready for approval" })).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve" }).first();
    await expect(approve).toBeEnabled();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-ready-en-390.png"),
      fullPage: true,
    });
  });

  test("2 — incomplete: translated server reasons and disabled Approve (EN + AR @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Missing information — approval is blocked" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Experience: Complete experience information\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();

    await openAdminProviderReview(page, { lang: "ar", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await expect(page.getByRole("heading", { name: "معلومات ناقصة — الموافقة متوقفة" })).toBeVisible();
    await expect(page.getByRole("link", { name: /الخبرة: أكمل معلومات الخبرة\./ })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-incomplete-ar-390.png"),
      fullPage: true,
    });
  });

  test("3 — pending/rejected identity documents show document blockers (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_pending" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Documents awaiting your review" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: /Documents: National ID \(front\) is uploaded but not approved yet\./,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();

    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_rejected" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Rejected documents must be replaced" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-docs-rejected-en-390.png"),
      fullPage: true,
    });
  });

  test("4 — loading and review failure never enable Approve incorrectly (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, {
      lang: "en",
      adminApprovalScenario: "ready",
      adminReviewDelayMs: 12_000,
    });
    await expect(page.locator("#admin-approval-decision")).toBeVisible();
    await expect(
      page.getByText("Checking whether this application can be approved"),
    ).toBeVisible();
    const approveWhileLoading = page.getByRole("button", { name: "Approve" }).first();
    await expect(approveWhileLoading).toBeDisabled();

    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "review_error" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Could not load approval requirements" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();
  });

  test("5 — Approve with mocked PostgREST rejection shows translated toast (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, {
      lang: "en",
      adminApprovalScenario: "ready",
      adminApproveReject: "incomplete",
    });
    await waitForDecisionLoaded(page);
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Application is incomplete and cannot be approved.",
    );
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-approve-toast-en-390.png"),
      fullPage: true,
    });
  });

  test("6 — document review errors use translated safe toast messages (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdminProviderReview(page, {
      lang: "en",
      adminApprovalScenario: "docs_pending",
      adminDocumentReviewFail: "documents_not_approved",
    });
    await waitForDecisionLoaded(page);
    await page
      .locator("#admin-provider-documents")
      .getByRole("button", { name: "Approve" })
      .first()
      .click();
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Required identity documents must be approved before approval.",
    );
  });

  test("7 — blocker links scroll to intended sections (EN @768)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await page.getByRole("link", { name: /Experience: Complete experience information\./ }).click();
    await expect(page.locator("#admin-onboarding-details")).toBeInViewport();

    await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_pending" });
    await waitForDecisionLoaded(page);
    await page
      .getByRole("link", {
        name: /Documents: National ID \(front\) is uploaded but not approved yet\./,
      })
      .click();
    await expect(page.locator("#admin-provider-documents")).toBeInViewport();
  });

  test("8 — responsive EN/AR: summary visible, Approve usable, no horizontal overflow", async ({
    page,
  }) => {
    for (const lang of ["en", "ar"] as const) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openAdminProviderReview(page, { lang, adminApprovalScenario: "ready" });
        await waitForDecisionLoaded(page);
        const readyHeading =
          lang === "en"
            ? page.getByRole("heading", { name: "Ready for approval" })
            : page.getByRole("heading", { name: "جاهز للموافقة" });
        await expect(readyHeading).toBeVisible();
        const approve =
          lang === "en"
            ? page.getByRole("button", { name: "Approve" }).first()
            : page.getByRole("button", { name: "قبول" }).first();
        await expect(approve).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `08-ready-${lang}-${vp.name}.png`),
          fullPage: true,
        });
      }
    }
  });
});
