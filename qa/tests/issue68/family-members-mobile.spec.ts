import { test, expect } from "@playwright/test";
import { installIssue68Mocks } from "./mock-supabase.mjs";

function toArabicIndicDigits(western: string): string {
  return western.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

async function fillMinimalChildForm(page: import("@playwright/test").Page, phone: string) {
  await page.getByPlaceholder("e.g. Layla Ahmed").fill("Youssef Ali");
  await page.getByRole("button", { name: "Daughter", exact: true }).click();
  await page.locator('input[type="date"]').fill("2020-06-15");
  const phoneInputs = page.getByPlaceholder("01xxxxxxxxx");
  await phoneInputs.first().fill(phone);
}

test.describe("Issue #86 family members mobile harness", () => {
  test("populated list action bar navigates to new member at 360px", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "family-members-populated" });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/family-members");
    await expect(page.getByText("Layla")).toBeVisible();
    await page.getByRole("button", { name: /Add family member/i }).click();
    await expect(page).toHaveURL(/\/family-members\/new$/);
    await mocks.assertIsolated();
  });

  test("empty state link navigates to new member at 390px", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "family-members-empty" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/family-members");
    await expect(page.getByText(/No family members yet/i)).toBeVisible();
    await page.getByRole("link", { name: /Add family member/i }).click();
    await expect(page).toHaveURL(/\/family-members\/new$/);
    await mocks.assertIsolated();
  });

  test("accepts Arabic-Indic phone digits, saves, and refreshes the list", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "family-members-populated" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/family-members/new");
    const arabicPhone = toArabicIndicDigits("0101221000633");
    await fillMinimalChildForm(page, arabicPhone);
    await page.getByTestId("family-member-save").click();
    await expect(page).toHaveURL(/\/family-members$/);
    await expect(page.getByText("Youssef Ali")).toBeVisible();
    await expect
      .poll(async () => {
        const calls = await mocks.getCalls();
        return calls.familyMemberWrites?.length ?? 0;
      })
      .toBe(1);
    const calls = await mocks.getCalls();
    expect(calls.familyMemberWrites[0].phone).toBe("+20101221000633");
    expect(calls.familyMemberListReads).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });
});

test.describe("Issue #86 family members — WebKit / iOS Safari", () => {
  test.skip(
    ({ browserName }) => browserName !== "webkit",
    "WebKit project not selected; run with ISSUE68_WEBKIT=1 when browsers are installed",
  );

  test("populated list CTA tap navigates on WebKit", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "family-members-populated" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/family-members");
    await page.getByRole("button", { name: /Add family member/i }).click();
    await expect(page).toHaveURL(/\/family-members\/new$/);
    await mocks.assertIsolated();
  });
});
