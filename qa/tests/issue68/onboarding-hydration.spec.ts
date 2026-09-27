import { test, expect } from "@playwright/test";
import {
  QA_AVATAR_JPEG,
  gotoOnboardingHarness,
  installIssue68Mocks,
  openExperienceStep,
} from "./mock-supabase.mjs";

test.describe("Issue #68 ProviderOnboardingFlow browser harness", () => {
  test("snapshot-first: legacy pre-68 component locks default experience values", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, {
      snapshotDelayMs: 0,
      providerDelayMs: 2500,
    });

    await openExperienceStep(page, "legacy");
    await expect(page.locator('input[type="number"]').first()).toHaveValue("1");
    await expect(page.getByRole("textbox", { name: "Bio (English)" })).toHaveValue("");
    const calls = await mocks.getCalls();
    expect(calls.snapshot).toBeGreaterThanOrEqual(1);
    expect(calls.provider).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });

  test("snapshot-first: current component hydrates snapshot.provider fields after both queries", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, {
      snapshotDelayMs: 0,
      providerDelayMs: 2500,
    });

    await openExperienceStep(page, "current");
    await expect(page.locator('input[type="number"]').first()).toHaveValue("9");
    await expect(page.getByRole("textbox", { name: "Bio (English)" })).toHaveValue(
      "Persisted EN bio issue68",
    );
    const calls = await mocks.getCalls();
    expect(calls.snapshot).toBeGreaterThanOrEqual(1);
    expect(calls.provider).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });

  test("provider-first: current component still hydrates persisted experience after both queries", async ({
    page,
  }) => {
    const mocks = await installIssue68Mocks(page, {
      snapshotDelayMs: 1500,
      providerDelayMs: 0,
    });

    await openExperienceStep(page, "current");
    await expect(page.locator('input[type="number"]').first()).toHaveValue("9");
    const calls = await mocks.getCalls();
    expect(calls.snapshot).toBeGreaterThanOrEqual(1);
    expect(calls.provider).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });

  test("photo upload waits for storage, profile, finalize, and snapshot refetch", async ({ page }) => {
    const mocks = await installIssue68Mocks(page);
    const legalName = await gotoOnboardingHarness(page, "current");
    await legalName.fill("Unsaved legal name edit");
    await expect(legalName).toHaveValue("Unsaved legal name edit");

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "qa-avatar.jpg",
      mimeType: "image/jpeg",
      buffer: QA_AVATAR_JPEG,
    });

    await expect
      .poll(async () => {
        const calls = await mocks.getCalls();
        return (
          calls.storageAvatars >= 1 &&
          calls.profileUpdate >= 1 &&
          calls.prepareDocument >= 1 &&
          calls.storageDocuments >= 1 &&
          calls.finalizeDocument >= 1 &&
          calls.snapshot >= 2
        );
      })
      .toBe(true);

    const calls = await mocks.getCalls();
    expect(calls.storageAvatars).toBeGreaterThanOrEqual(1);
    expect(calls.profileUpdate).toBeGreaterThanOrEqual(1);
    expect(calls.prepareDocument).toBeGreaterThanOrEqual(1);
    expect(calls.storageDocuments).toBeGreaterThanOrEqual(1);
    expect(calls.finalizeDocument).toBeGreaterThanOrEqual(1);
    expect(calls.snapshot).toBeGreaterThanOrEqual(2);
    await expect(legalName).toHaveValue("Unsaved legal name edit");
    await mocks.assertIsolated();
  });

  test("EN edit preserves Arabic biography in the save payload", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { lang: "en" });
    await openExperienceStep(page, "current", "en");
    await page.getByRole("textbox", { name: "Bio (English)" }).fill("Updated EN only");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect.poll(async () => (await mocks.getCalls()).saves.length).toBeGreaterThan(0);
    const save = (await mocks.getCalls()).saves.at(-1);
    expect(save?.p_payload?.bio_en).toBe("Updated EN only");
    expect(save?.p_payload?.bio_ar).toBe("سيرة عربية محفوظة");
    await mocks.assertIsolated();
  });

  test("AR edit preserves English biography in the save payload", async ({ page }) => {
    const mocks = await installIssue68Mocks(page, { lang: "ar" });
    await openExperienceStep(page, "current", "ar");
    await page.getByRole("textbox", { name: "نبذة (العربية)" }).fill("سيرة عربية محدثة");
    await page.getByRole("button", { name: "متابعة" }).click();

    await expect.poll(async () => (await mocks.getCalls()).saves.length).toBeGreaterThan(0);
    const save = (await mocks.getCalls()).saves.at(-1);
    expect(save?.p_payload?.bio_ar).toBe("سيرة عربية محدثة");
    expect(save?.p_payload?.bio_en).toBe("Persisted EN bio issue68");
    await mocks.assertIsolated();
  });

  test("useProviders wiring hides fixture service_slug rows", async ({ page }) => {
    const mocks = await installIssue68Mocks(page);
    await page.goto("/marketplace");
    await expect(page.getByTestId("provider-count")).toHaveText("1", { timeout: 15_000 });
    await expect(page.locator('[data-service-slug="qa-booking-service-1785235277607"]')).toHaveCount(0);
    await expect(page.locator('[data-service-slug="deep-home-cleaning"]')).toHaveCount(1);
    const calls = await mocks.getCalls();
    expect(calls.marketplace).toBeGreaterThanOrEqual(1);
    await mocks.assertIsolated();
  });

  test("records actual source revision and harness content hashes", async ({ request }) => {
    const identity = await request.get("/__issue68/identity").then((res) => res.json());
    expect(identity.head).toMatch(/^[a-f0-9]{40}$/);
    expect(identity.legacy.faithful).toBe(true);
    expect(identity.legacy.arabicPreserved).toBe(true);
    expect(identity.legacy.exportRenamed).toBe(true);
    expect(identity.legacy.unexpectedExport).toBe(false);
    expect(identity.hashes["src/components/provider/ProviderOnboardingFlow.tsx"]).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.hashes["qa/tests/issue68/fixtures/ProviderOnboardingFlow.pre68.tsx"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    console.log(`[issue68-identity] HEAD ${identity.head}`);
    console.log(`[issue68-identity] legacy ${identity.legacySourceCommit} faithful=${identity.legacy.faithful}`);
    console.log(`[issue68-identity] hashes ${JSON.stringify(identity.hashes)}`);
  });
});
