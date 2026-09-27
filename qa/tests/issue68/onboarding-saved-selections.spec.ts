import { test, expect } from "@playwright/test";
import {
  gotoOnboardingHarness,
  gotoProOnboardingRoute,
  installIssue68Mocks,
  openOnboardingStep,
} from "./mock-supabase.mjs";

test.describe("Issue #69 saved onboarding selections", () => {
  test("returning provider keeps both zones and both references when clicking through", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "returning" });
    await gotoOnboardingHarness(page, "current");

    await openOnboardingStep(page, "Coverage");
    await expect(page.getByRole("button", { name: "Maadi", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zayed", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect
      .poll(async () => {
        const coverage = (await mocks.getCalls()).saves.find(
          (save) => save.p_section === "coverage",
        );
        return coverage?.p_payload?.zone_ids ?? null;
      })
      .toEqual(["zone-maadi", "zone-zayed"]);

    await expect(page.getByPlaceholder("Full name").first()).toHaveValue("Nadia Kamal");
    await expect(page.getByPlaceholder("Full name").nth(1)).toHaveValue("Layla Hassan");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect
      .poll(async () => {
        const refs = (await mocks.getCalls()).saves.find((save) => save.p_section === "references");
        return refs?.p_payload?.references?.map((row) => row.full_name) ?? null;
      })
      .toEqual(["Nadia Kamal", "Layla Hassan"]);

    const saves = (await mocks.getCalls()).saves;
    expect(saves.filter((save) => save.p_section === "coverage")).toHaveLength(1);
    expect(saves.filter((save) => save.p_section === "references")).toHaveLength(1);
    await mocks.assertIsolated();
  });

  test("new provider reaches the wizard after start_onboarding instead of the error screen", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "new-provider" });
    await gotoProOnboardingRoute(page);

    const errorScreen = page.getByText("Something went wrong");
    const legalName = page.getByRole("textbox", { name: "Full legal name" });

    await Promise.race([
      legalName.waitFor({ state: "visible", timeout: 15_000 }),
      errorScreen.waitFor({ state: "visible", timeout: 15_000 }),
    ]);

    const errorVisible = await errorScreen.isVisible().catch(() => false);
    const wizardVisible = await legalName.isVisible().catch(() => false);
    if (errorVisible && !wizardVisible) {
      await page.screenshot({
        path: "test-results/issue69-new-provider-error.png",
        fullPage: true,
      });
    }

    await expect(errorScreen, "new provider must not stay on the QueryError screen").toHaveCount(0);
    await expect(legalName).toBeVisible();

    const calls = await mocks.getCalls();
    expect(calls.startOnboarding).toBeGreaterThanOrEqual(1);
    expect(calls.provider).toBeGreaterThanOrEqual(2);
    expect(calls.snapshot).toBeGreaterThanOrEqual(2);
    await mocks.assertIsolated();
  });

  test("coverage waits for the active-zone catalog before saving a valid selection", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, {
      scenario: "returning",
      zonesDelayMs: 4000,
    });
    await gotoOnboardingHarness(page, "current");
    await openOnboardingStep(page, "Coverage");

    await expect(page.getByText("Loading your saved selections…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("button", { name: "Continue" }).click({ force: true });
    expect((await mocks.getCalls()).saves).toEqual([]);
    await expect(page.getByText("Select at least one service zone.")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Maadi", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect
      .poll(async () => {
        const coverage = (await mocks.getCalls()).saves.find(
          (save) => save.p_section === "coverage",
        );
        return coverage?.p_payload?.zone_ids ?? null;
      })
      .toEqual(["zone-maadi", "zone-zayed"]);
    await mocks.assertIsolated();
  });

  test("failed saved-data queries block coverage and references saves", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { scenario: "saved-data-error" });
    await gotoOnboardingHarness(page, "current");

    await openOnboardingStep(page, "Coverage");
    await expect(
      page.getByText("Could not load your saved selections. Saving this step is blocked."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("button", { name: "Continue" }).click({ force: true });

    await openOnboardingStep(page, "References");
    await expect(
      page.getByText("Could not load your saved selections. Saving this step is blocked."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.getByRole("button", { name: "Continue" }).click({ force: true });

    const calls = await mocks.getCalls();
    expect(calls.saves).toEqual([]);
    await mocks.assertIsolated();
  });
});
