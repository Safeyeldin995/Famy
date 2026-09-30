import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { installIssue68Mocks } from "./mock-supabase.mjs";

const VIEWPORTS = [
  { width: 360, height: 740, name: "360" },
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1280, height: 900, name: "1280" },
] as const;

type HarnessOptions = Parameters<typeof installIssue68Mocks>[1];

type ResponsiveScenario = "ready" | "incomplete" | "docs_rejected";

const SCENARIO_CONFIG: Record<
  ResponsiveScenario,
  { adminApprovalScenario: HarnessOptions["adminApprovalScenario"] }
> = {
  ready: { adminApprovalScenario: "ready" },
  incomplete: { adminApprovalScenario: "incomplete" },
  docs_rejected: { adminApprovalScenario: "docs_rejected" },
};

function labelsFor(lang: "en" | "ar", scenario: ResponsiveScenario) {
  if (lang === "en") {
    return {
      summary:
        scenario === "ready"
          ? "Ready for approval"
          : scenario === "incomplete"
            ? "Missing information — approval is blocked"
            : "Rejected documents must be replaced",
      approve: "Approve",
      requestChanges: "Request changes",
      back: "Back",
    };
  }
  return {
    summary:
      scenario === "ready"
        ? "جاهز للموافقة"
        : scenario === "incomplete"
          ? "معلومات ناقصة — الموافقة متوقفة"
          : "يجب استبدال المستندات المرفوضة",
    approve: "قبول",
    requestChanges: "طلب تعديلات",
    back: "رجوع",
  };
}

async function assertNotClippedByViewport(page: Page, locator: Locator) {
  const ok = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right < 0 || rect.left > vw) return false;
    if (rect.bottom < 0 || rect.top > vh) return false;

    let node: Element | null = el;
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) break;
      const style = getComputedStyle(parent);
      const clipsX =
        style.overflowX === "hidden" ||
        style.overflowX === "clip" ||
        style.overflow === "hidden" ||
        style.overflow === "clip";
      const clipsY =
        style.overflowY === "hidden" ||
        style.overflowY === "clip" ||
        style.overflow === "hidden" ||
        style.overflow === "clip";
      if (clipsX || clipsY) {
        const parentRect = parent.getBoundingClientRect();
        if (clipsX && (rect.right > parentRect.right + 1 || rect.left < parentRect.left - 1)) {
          return false;
        }
        if (clipsY && (rect.bottom > parentRect.bottom + 1 || rect.top < parentRect.top - 1)) {
          const isScrollableOverflow =
            parent.classList.contains("overflow-y-auto") ||
            parent.classList.contains("max-h-40");
          if (!isScrollableOverflow) return false;
        }
      }
      node = parent;
    }
    return rect.left >= -1 && rect.right <= vw + 1;
  });
  expect(ok).toBe(true);
}

async function openAdminProviderReview(page: Page, options: HarnessOptions = {}) {
  const mocks = await installIssue68Mocks(page, options);
  await page.goto("/admin-provider-review");
  await expect(page.getByTestId("issue68-admin-provider-review")).toBeVisible();
  return mocks;
}

async function waitForDecisionLoaded(page: Page) {
  await expect(page.locator("#admin-approval-decision")).toBeVisible();
  await expect(page.locator("#admin-approval-decision .animate-spin")).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function assertPrimaryControlsUsable(
  page: Page,
  lang: "en" | "ar",
  scenario: ResponsiveScenario,
) {
  const labels = labelsFor(lang, scenario);
  const summary = page.getByRole("heading", { name: labels.summary });
  await expect(summary).toBeVisible();
  await assertNotClippedByViewport(page, summary);

  const back = page.getByRole("link", { name: labels.back });
  await expect(back).toBeVisible();
  await assertNotClippedByViewport(page, back);

  const approve = page.getByRole("button", { name: labels.approve }).first();
  await expect(approve).toBeVisible();
  await assertNotClippedByViewport(page, approve);

  const requestChanges = page.getByRole("button", { name: labels.requestChanges });
  await expect(requestChanges).toBeVisible();
  await assertNotClippedByViewport(page, requestChanges);

  if (scenario === "incomplete") {
    const blocker = page.getByRole("link", {
      name: lang === "en" ? /Experience: Complete experience information\./ : /الخبرة: أكمل معلومات الخبرة\./,
    });
    await expect(blocker).toBeVisible();
    await assertNotClippedByViewport(page, blocker);
  }
}

test.describe("PR #82 admin provider approval review (issue68 mocked browser)", () => {
  test("1 — complete + approved documents: ready summary and enabled Approve (EN @390)", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "ready" });
    await waitForDecisionLoaded(page);
    await expect(page.getByRole("heading", { name: "Ready for approval" })).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve" }).first();
    await expect(approve).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("01-ready-en-390.png"), fullPage: true });
    await mocks.assertIsolated();
  });

  test("2 — incomplete: translated server reasons and disabled Approve (EN + AR @390)", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Missing information — approval is blocked" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Experience: Complete experience information\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();

    mocks = await openAdminProviderReview(page, { lang: "ar", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await expect(page.getByRole("heading", { name: "معلومات ناقصة — الموافقة متوقفة" })).toBeVisible();
    await expect(page.getByRole("link", { name: /الخبرة: أكمل معلومات الخبرة\./ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-incomplete-ar-390.png"), fullPage: true });
    await mocks.assertIsolated();
  });

  test("3 — pending/rejected identity documents show document blockers (EN @390)", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_pending" });
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

    mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_rejected" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Rejected documents must be replaced" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("03-docs-rejected-en-390.png"), fullPage: true });
    await mocks.assertIsolated();
  });

  test("4 — loading and review failure never enable Approve incorrectly (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let mocks = await openAdminProviderReview(page, {
      lang: "en",
      adminApprovalScenario: "ready",
      adminReviewDelayMs: 12_000,
    });
    await expect(page.locator("#admin-approval-decision")).toBeVisible();
    await expect(
      page.getByText("Checking whether this application can be approved"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();

    mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "review_error" });
    await waitForDecisionLoaded(page);
    await expect(
      page.getByRole("heading", { name: "Could not load approval requirements" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeDisabled();
    await mocks.assertIsolated();
  });

  test("5 — Approve PostgREST rejection shows translated toast (EN + AR @390)", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let mocks = await openAdminProviderReview(page, {
      lang: "en",
      adminApprovalScenario: "ready",
      adminApproveReject: "incomplete",
    });
    await waitForDecisionLoaded(page);
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Application is incomplete and cannot be approved.",
    );
    await page.screenshot({ path: testInfo.outputPath("05-approve-toast-en-390.png"), fullPage: true });
    await mocks.assertIsolated();

    mocks = await openAdminProviderReview(page, {
      lang: "ar",
      adminApprovalScenario: "ready",
      adminApproveReject: "incomplete",
    });
    await waitForDecisionLoaded(page);
    await page.getByRole("button", { name: "قبول" }).first().click();
    const toast = page.locator("[data-sonner-toast]").last();
    await expect(toast).toContainText("الطلب غير مكتمل ولا يمكن الموافقة عليه.");
    await expect(toast).not.toContainText("Application is incomplete");
    await page.screenshot({ path: testInfo.outputPath("05-approve-toast-ar-390.png"), fullPage: true });
    await mocks.assertIsolated();
  });

  test("6 — document review errors use translated safe toast messages (EN @390)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const mocks = await openAdminProviderReview(page, {
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
    await mocks.assertIsolated();
  });

  test("7 — blocker links scroll to intended sections (EN @768)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    let mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "incomplete" });
    await waitForDecisionLoaded(page);
    await page.getByRole("link", { name: /Experience: Complete experience information\./ }).click();
    await expect(page.locator("#admin-onboarding-details")).toBeInViewport();

    mocks = await openAdminProviderReview(page, { lang: "en", adminApprovalScenario: "docs_pending" });
    await waitForDecisionLoaded(page);
    await page
      .getByRole("link", {
        name: /Documents: National ID \(front\) is uploaded but not approved yet\./,
      })
      .click();
    await expect(page.locator("#admin-provider-documents")).toBeInViewport();
    await mocks.assertIsolated();
  });

  test("8 — responsive EN/AR: controls within viewport, not clipped (ready/incomplete/rejected)", async ({
    page,
  }, testInfo: TestInfo) => {
    for (const scenario of ["ready", "incomplete", "docs_rejected"] as const) {
      for (const lang of ["en", "ar"] as const) {
        for (const vp of VIEWPORTS) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const mocks = await openAdminProviderReview(page, {
            lang,
            adminApprovalScenario: SCENARIO_CONFIG[scenario].adminApprovalScenario,
          });
          await waitForDecisionLoaded(page);
          await assertPrimaryControlsUsable(page, lang, scenario);
          await page.screenshot({
            path: testInfo.outputPath(`08-${scenario}-${lang}-${vp.name}.png`),
            fullPage: true,
          });
          await mocks.assertIsolated();
        }
      }
    }
  });
});
