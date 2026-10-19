import { test, expect } from "@playwright/test";
import {
  gotoOnboardingHarness,
  installIssue68Mocks,
  openOnboardingStep,
  QA_AVATAR_JPEG,
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
    await gotoOnboardingHarness(page, "current");
    await openOnboardingStep(page, "Services");
    await page.getByRole("button", { name: /^Babysitting/ }).click();
    await openOnboardingStep(page, "Experience");

    const bioEn = page.getByRole("textbox", { name: "Bio (English)" });
    await expect(bioEn).toHaveValue("Persisted EN bio issue68");
    await bioEn.fill("Unsaved EN bio");
    const maxChildren = page.getByLabel("Maximum children per booking");
    await expect(maxChildren).toHaveValue("2");
    await maxChildren.fill("7");
    const toddlerYears = page.getByLabel("Years of experience with this age group");
    await expect(toddlerYears).toHaveValue("4");
    await toddlerYears.fill("11");
    await page.getByRole("button", { name: "Infants", exact: true }).click();

    const before = await mocks.getCalls();
    expect(before.snapshot).toBeGreaterThanOrEqual(1);

    await mocks.setSnapshot({
      provider: {
        bio_en: "SERVER OVERWRITE EN",
        bio_ar: "سيرة مستبدلة",
        years_experience: 1,
        max_children_per_booking: 9,
      },
      age_group_capabilities: [
        { code: "preschool", years_experience: 1, note: "server", verified_at: null },
      ],
    });

    await openOnboardingStep(page, "Personal details");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "qa-avatar.jpg",
      mimeType: "image/jpeg",
      buffer: QA_AVATAR_JPEG,
    });

    await expect
      .poll(async () => {
        const calls = await mocks.getCalls();
        return (
          calls.snapshot >= before.snapshot + 1 &&
          calls.lastSnapshot?.provider?.max_children_per_booking === 9 &&
          calls.lastSnapshot?.provider?.bio_en === "SERVER OVERWRITE EN"
        );
      })
      .toBe(true);

    await openOnboardingStep(page, "Experience");
    await expect(page.getByRole("textbox", { name: "Bio (English)" })).toHaveValue(
      "Unsaved EN bio",
    );
    await expect(page.getByLabel("Maximum children per booking")).toHaveValue("7");
    await expect(page.getByLabel("Years of experience with this age group").nth(1)).toHaveValue(
      "11",
    );
    await expect(page.getByRole("button", { name: "Infants", exact: true })).toHaveClass(
      /bg-brand/,
    );
    await expect(page.getByRole("button", { name: "Toddlers", exact: true })).toHaveClass(
      /bg-brand/,
    );
    await expect(
      page.getByRole("button", { name: "Preschool children", exact: true }),
    ).not.toHaveClass(/bg-brand/);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect
      .poll(async () => {
        const experience = (await mocks.getCalls()).saves.find(
          (save) => save.p_section === "experience",
        );
        return experience?.p_payload ?? null;
      })
      .toMatchObject({
        bio_en: "Unsaved EN bio",
        bio_ar: "سيرة عربية محفوظة",
        max_children_per_booking: 7,
      });
    const experience = (await mocks.getCalls()).saves.find(
      (save) => save.p_section === "experience",
    );
    expect(experience.p_payload.age_group_capabilities.map((row) => row.code).sort()).toEqual([
      "infant",
      "toddler",
    ]);
    expect(
      experience.p_payload.age_group_capabilities.find((row) => row.code === "toddler")
        .years_experience,
    ).toBe(11);
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
