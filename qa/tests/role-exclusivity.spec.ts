import { expect, test } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("Customer and Provider identities remain exclusive and Admin lists stay separated", async ({ page }) => {
  const registry = readRegistry();
  const customer = registry.users.find((user: any) => user.key === "customer");
  const providerUser = registry.users.find((user: any) => user.key === "provider");
  expect(customer).toBeTruthy();
  expect(providerUser).toBeTruthy();

  const customerRoles = await supabaseAdmin.from("user_roles").select("role").eq("user_id", customer.userId);
  const providerRoles = await supabaseAdmin.from("user_roles").select("role").eq("user_id", providerUser.userId);
  expect(customerRoles.data?.map((row) => row.role)).toEqual(["customer"]);
  expect(providerRoles.data?.map((row) => row.role)).toEqual(["provider"]);

  const customerClient = authenticatedClient("customer");
  const forbiddenOnboarding = await customerClient.rpc("create_provider_profile", {
    p_bio_en: "QA_ forbidden Customer conversion",
    p_bio_ar: "",
    p_years_experience: 1,
    p_hourly_rate: 100,
    p_city: "Cairo",
    p_languages: ["english"],
  });
  expect(forbiddenOnboarding.error?.code).toBe("42501");
  const forbiddenRole = await customerClient.from("user_roles").insert({ user_id: customer.userId, role: "provider" });
  expect(forbiddenRole.error).toBeTruthy();
  expect((await supabaseAdmin.from("providers").select("id").eq("profile_id", customer.userId)).data).toEqual([]);
  expect((await supabaseAdmin.from("user_roles").select("role").eq("user_id", customer.userId)).data?.map((row) => row.role)).toEqual(["customer"]);

  const { readErrors } = captureErrors(page);
  await page.goto("/admin/customers");
  await page.getByPlaceholder(/search/i).fill("QA_");
  await expect(page.getByText("QA_customer_e2e", { exact: true })).toBeVisible();
  await expect(page.getByText("QA_provider_e2e", { exact: true })).toHaveCount(0);

  await page.goto("/admin/providers");
  await page.getByRole("button", { name: /^all$/i }).click();
  await page.getByPlaceholder(/search/i).fill("QA_");
  const providerDirectory = page.locator("ul.divide-y").last();
  await expect(providerDirectory.getByText("QA_provider_e2e", { exact: true })).toBeVisible();
  await expect(providerDirectory.getByText("QA_customer_e2e", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator("ul.divide-y").last().getByText("QA_provider_e2e", { exact: true })).toBeVisible();
  expect(readErrors()).toEqual({ console: [], network: [] });
});
