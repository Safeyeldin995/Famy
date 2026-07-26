import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { resetRegistryProviderToDraft } from "./registry-fixtures.mjs";

async function createIsolatedDraftProvider() {
  const email = `qa-draft-gate-${Date.now()}@famio.local`;
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: "QaDraftGate123!",
    email_confirm: true,
    user_metadata: { full_name: "QA Draft Gate Provider" },
  });
  expect(error).toBeNull();
  const uid = created!.user!.id;
  await supabaseAdmin.from("user_roles").delete().eq("user_id", uid).eq("role", "customer");
  await supabaseAdmin.from("user_roles").upsert({ user_id: uid, role: "provider" });
  await supabaseAdmin.from("profiles").upsert({
    id: uid,
    full_name: "QA Draft Gate Provider",
    phone: `+20100${Date.now().toString().slice(-7)}`,
  });
  const { data: draftProvider, error: insertErr } = await supabaseAdmin.from("providers").insert({
    profile_id: uid,
    bio_en: "",
    bio_ar: "",
    years_experience: 0,
    hourly_rate: 1,
    city: "Cairo",
    country: "EG",
    languages: [],
    is_active: true,
    is_verified: false,
    onboarding_status: "DRAFT",
  }).select("id, onboarding_status").single();
  expect(insertErr).toBeNull();
  expect(draftProvider?.onboarding_status).toBe("DRAFT");
  await supabaseAdmin.from("provider_onboarding_details").insert({ provider_id: draftProvider!.id });
  return { providerId: draftProvider!.id, displayName: "QA Draft Gate Provider", userId: uid };
}

test.describe("provider onboarding flow", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/provider.json") });

  test("Arabic onboarding wizard renders RTL progress", async ({ page }) => {
    await resetRegistryProviderToDraft();
    await page.addInitScript(() => localStorage.setItem("famio.lang", "ar"));
    await page.goto("/pro/onboarding");
    await expect(page.locator("html[dir='rtl']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /تسجيل مزود الخدمة/i })).toBeVisible();
    await expect(page.getByText(/البيانات الشخصية/i)).toBeVisible();
  });
});

test.describe("admin onboarding gating", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

  test("draft provider has no approve button on list or detail", async ({ page }) => {
    const draft = await createIsolatedDraftProvider();

    await page.goto("/admin/providers");
    const row = page.getByRole("listitem").filter({ hasText: draft.displayName });
    await expect(row.getByRole("button", { name: /^approve$/i })).toHaveCount(0);

    await page.goto(`/admin/provider/${draft.providerId}`);
    await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(0);

    await supabaseAdmin.from("providers").delete().eq("id", draft.providerId);
    await supabaseAdmin.auth.admin.deleteUser(draft.userId);
  });
});
