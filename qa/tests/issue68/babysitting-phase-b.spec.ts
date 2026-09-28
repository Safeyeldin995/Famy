import { test, expect } from "@playwright/test";
import {
  gotoOnboardingHarness,
  installIssue68Mocks,
  openOnboardingStep,
} from "./mock-supabase.mjs";
import { MOCK_PROVIDER_ID } from "../../issue68-host/constants.mjs";

async function continueFromServiceToForWhom(page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick date & time" })).toBeVisible();
  const time = page.getByRole("combobox", { name: /Time/ });
  await expect(time).toBeVisible();
  await time.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test.describe("Phase B babysitting declaration and one-child booking UI", () => {
  test("onboarding experience saves catalogue capabilities and max children", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "default" });
    await gotoOnboardingHarness(page, "current");
    await openOnboardingStep(page, "Services");
    await page.getByRole("button", { name: /^Babysitting/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("button", { name: "Infants", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Toddlers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Teenagers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "School", exact: true })).toHaveCount(0);

    const maxChildren = page.locator('input[type="number"]').nth(1);
    await maxChildren.fill("2");
    await page.getByRole("button", { name: "Infants", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect
      .poll(async () => {
        const experience = (await mocks.getCalls()).saves.find(
          (save) => save.p_section === "experience",
        );
        return experience?.p_payload ?? null;
      })
      .toMatchObject({
        max_children_per_booking: 2,
      });
    const experience = (await mocks.getCalls()).saves.find(
      (save) => save.p_section === "experience",
    );
    expect(experience.p_payload.age_group_capabilities.map((row) => row.code).sort()).toEqual([
      "infant",
      "toddler",
    ]);
    await mocks.assertIsolated();
  });

  test("unsaved experience years survive a snapshot refetch", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { snapshotDelayMs: 0 });
    const legalName = await gotoOnboardingHarness(page, "current");
    await legalName.fill("Unsaved legal name edit");
    await openOnboardingStep(page, "Experience");
    const years = page.locator('input[type="number"]').first();
    await years.fill("11");
    await expect(years).toHaveValue("11");
    await openOnboardingStep(page, "Personal details");
    await expect(page.getByRole("textbox", { name: "Full legal name" })).toHaveValue(
      "Unsaved legal name edit",
    );
    await mocks.assertIsolated();
  });

  test("book flow hides Myself for babysitting and keeps it for home-cleaning", async ({
    page,
  }) => {
    const sitMocks = await installIssue68Mocks(page, { scenario: "book-babysitting" });
    await page.goto(`/book/${MOCK_PROVIDER_ID}?serviceId=svc-sit`);
    await expect(page.getByText("Babysitting").first()).toBeVisible({ timeout: 15_000 });
    await continueFromServiceToForWhom(page);
    await expect(page.getByText("Which child is this for?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Myself", exact: true })).toHaveCount(0);
    await expect(page.getByText("Layla")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("button", { name: /Layla/ }).click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await sitMocks.assertIsolated();

    const cleanMocks = await installIssue68Mocks(page, { scenario: "book-cleaning" });
    await page.goto(`/book/${MOCK_PROVIDER_ID}?serviceId=svc-clean`);
    await expect(page.getByText("Deep Home Cleaning").first()).toBeVisible({ timeout: 15_000 });
    await continueFromServiceToForWhom(page);
    await expect(page.getByRole("button", { name: "Myself", exact: true })).toBeVisible();
    await cleanMocks.assertIsolated();
  });
});
