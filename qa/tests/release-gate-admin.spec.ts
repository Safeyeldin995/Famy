import { expect, test } from "@playwright/test";
import path from "path";
import { authenticatedClient } from "../authenticated-client.mjs";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

const STATEMENT_FIXTURE_REASON = "QA_release_gate_statement_fixture";
const STATEMENT_CLEANUP_REASON = "QA_release_gate_statement_cleanup";

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

  const admin = authenticatedClient("admin");
  const { data: ledgerEntryId, error: seedError } = await admin.rpc("admin_provider_ledger_adjustment", {
    p_provider_id: providerId,
    p_direction: "credit",
    p_amount: 1,
    p_reason: STATEMENT_FIXTURE_REASON,
    p_note: "QA release gate provider statement PDF",
  });
  expect(seedError).toBeNull();
  expect(ledgerEntryId).toBeTruthy();

  try {
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
    await expect(downloadLink).not.toHaveAttribute("aria-disabled", "true");
    await downloadLink.click();
    const printPage = await popupPromise;
    await printPage.waitForLoadState("domcontentloaded");
    await expect(printPage.locator(".statement-print")).toBeVisible({ timeout: 20_000 });
    await expect(printPage.getByText(/opening balance|الرصيد/i)).toBeVisible();
    expect(readErrors().console).toEqual([]);
  } finally {
    const { error: cleanupError } = await admin.rpc("admin_provider_ledger_adjustment", {
      p_provider_id: providerId,
      p_direction: "debit",
      p_amount: 1,
      p_reason: STATEMENT_CLEANUP_REASON,
      p_note: `reverse ${ledgerEntryId}`,
    });
    expect(cleanupError).toBeNull();
  }
});