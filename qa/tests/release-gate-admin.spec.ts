import { expect, test } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

const RELEASE_GATE_SCREENS: Array<{ path: string; heading: RegExp }> = [
  { path: "/admin/reports", heading: /report/i },
  { path: "/admin/payments", heading: /payment/i },
  { path: "/admin/monitoring", heading: /monitoring/i },
  { path: "/admin/settings", heading: /settings/i },
];

for (const screen of RELEASE_GATE_SCREENS) {
  test(`release gate admin: ${screen.path}`, async ({ page }) => {
    const { readErrors } = captureErrors(page);
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading }).first()).toBeVisible({
      timeout: 20_000,
    });
    const errors = readErrors();
    expect(errors.network.filter((e) => !e.includes("favicon"))).toEqual([]);
    expect(errors.console).toEqual([]);
  });
}

test("release gate: provider statement print preview", async ({ page, context }) => {
  test.setTimeout(60_000);
  const { readErrors } = captureErrors(page);
  const providerUser = readRegistry().users.find((user) => user.key === "provider");
  expect(providerUser).toBeTruthy();
  const { data: provider, error } = await supabaseAdmin
    .from("providers")
    .select("id")
    .eq("profile_id", providerUser!.userId)
    .single();
  expect(error).toBeNull();
  const providerId = provider!.id;

  await page.goto(`/admin/provider/${providerId}`);
  await expect(page.getByRole("heading", { name: /QA_provider_e2e/i })).toBeVisible({
    timeout: 20_000,
  });

  const statementButton = page.getByRole("button", { name: /statement|كشف حساب/i });
  await statementButton.click();
  await expect(
    page.getByRole("heading", { name: /provider statement|كشف حساب مقدم/i }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  const popupPromise = context.waitForEvent("page");
  const downloadLink = page.getByRole("link", { name: /download pdf|تنزيل pdf/i });
  await expect(downloadLink).toBeVisible({ timeout: 15_000 });
  await downloadLink.click();
  const printPage = await popupPromise;
  await printPage.waitForLoadState("domcontentloaded");
  await expect(printPage.locator(".statement-print")).toBeVisible({ timeout: 20_000 });
  await expect(printPage.getByText(/opening balance|الرصيد/i)).toBeVisible();
  expect(readErrors().console).toEqual([]);
});