import { test, expect } from "@playwright/test";
import { supabaseAdmin } from "../admin-client.mjs";

const QA_PASSWORD = "QaRuntime!2026Test";

test("customer becoming a provider ends up with only the provider role", async ({ page, baseURL }) => {
  const phone = `10${Date.now().toString().slice(-6)}09`;

  // 1) Sign up as a plain customer through the real UI.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("button", { name: /^customer$/i }).click();
  await page.locator('input[inputmode="tel"]').fill(phone);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/auth\/set-password/, { timeout: 15_000 });
  await page.locator('input[type="password"]').fill(QA_PASSWORD);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/(setup|home)/, { timeout: 15_000 });

  const authEmail = `phone-20${phone}@famio.local`;
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = authUsers.users.find((u) => u.email === authEmail);
  expect(user, "QA user should exist after signup").toBeTruthy();
  await supabaseAdmin.from("profiles").update({ full_name: "QA_roleExclusivity_e2e" }).eq("id", user!.id);

  const rolesAfterSignup = await supabaseAdmin.from("user_roles").select("role").eq("user_id", user!.id);
  expect(rolesAfterSignup.data?.map((r) => r.role)).toEqual(["customer"]);

  // 2) Same user completes "become a provider" onboarding.
  await page.goto("/pro/onboarding");
  await page.locator("textarea").first().fill("QA_ automated exclusivity test provider bio.");
  await page.waitForTimeout(500);
  const cityButtons = page.locator("div.grid.grid-cols-2 > button");
  if (await cityButtons.count() > 0) await cityButtons.first().click();
  await page.getByRole("button", { name: /continue|creating/i }).click();
  await page.waitForURL(/\/pro\/documents|\/pro$/, { timeout: 15_000 }).catch(() => {});

  // 3) The DB-level exclusivity trigger must have dropped 'customer' when
  // 'provider' was granted — never both at once.
  const rolesAfterOnboarding = await supabaseAdmin.from("user_roles").select("role").eq("user_id", user!.id);
  const roles = rolesAfterOnboarding.data?.map((r) => r.role) ?? [];
  expect(roles).toContain("provider");
  expect(roles).not.toContain("customer");
  expect(roles.length).toBe(1);

  // cleanup (this test creates its own account outside the shared fixtures)
  await supabaseAdmin.from("providers").delete().eq("profile_id", user!.id);
  await supabaseAdmin.from("user_roles").delete().eq("user_id", user!.id);
  await supabaseAdmin.from("profiles").delete().eq("id", user!.id);
  await supabaseAdmin.auth.admin.deleteUser(user!.id);
});
