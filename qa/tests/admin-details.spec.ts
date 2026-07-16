import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

function expectClean(readErrors: ReturnType<typeof captureErrors>["readErrors"]) {
  const errors = readErrors();
  expect(errors.console).toEqual([]);
  expect(errors.network.filter((entry) => !entry.includes("favicon"))).toEqual([]);
}

test("provider details load real data and survive refresh", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const providerUser = readRegistry().users.find((user: any) => user.key === "provider");
  const { data: provider, error } = await supabaseAdmin
    .from("providers")
    .select("id,city,profile:profiles(full_name)")
    .eq("profile_id", providerUser.userId)
    .single();
  expect(error).toBeNull();

  await page.goto(`/admin/provider/${provider!.id}`);
  await expect(page.getByRole("heading", { name: /QA_provider_e2e/i })).toBeVisible();
  await expect(page.getByText(provider!.city)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /QA_provider_e2e/i })).toBeVisible();
  expectClean(readErrors);
});

test("customer details load real data and survive refresh", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const customer = readRegistry().users.find((user: any) => user.key === "customer");

  await page.goto(`/admin/customer/${customer.userId}`);
  await expect(page.getByRole("heading", { name: /QA_customer_e2e/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /QA_customer_e2e/i })).toBeVisible();
  expectClean(readErrors);
});

test("Admin list filters and search remain interactive without duplicate requests", async ({ page }) => {
  const { readErrors } = captureErrors(page);
  const requests = new Map<string, number>();
  page.on("request", (request) => {
    if (request.method() !== "GET" || !request.url().includes("/rest/v1/")) return;
    const key = request.url();
    requests.set(key, (requests.get(key) ?? 0) + 1);
  });

  await page.goto("/admin/providers");
  await page.getByRole("textbox", { name: /search by name, phone or city/i }).fill("QA_provider_e2e");
  await expect(page.getByText("QA_provider_e2e").first()).toBeVisible();
  await page.getByRole("button", { name: /^all$/i }).click();
  await expect(page.getByText("QA_provider_e2e").first()).toBeVisible();

  await page.goto("/admin/customers");
  await page.getByRole("textbox", { name: /search by name, phone or user ID/i }).fill("QA_customer_e2e");
  await expect(page.getByText("QA_customer_e2e").first()).toBeVisible();
  await page.getByRole("button", { name: /has bookings/i }).click();
  await page.getByRole("button", { name: /^all$/i }).click();
  await expect(page.getByText("QA_customer_e2e").first()).toBeVisible();

  const duplicateBursts = [...requests.entries()].filter(([, count]) => count > 2);
  expect(duplicateBursts, "no identical Admin GET should retry/refetch in a loop").toEqual([]);
  expectClean(readErrors);
});
