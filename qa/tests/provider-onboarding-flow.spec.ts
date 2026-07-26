import { test, expect } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { loadEnv } from "../env.mjs";
import { readRegistry } from "../registry.mjs";
import { submitProviderOnboarding } from "./onboarding-fixtures.mjs";
import { createEligibleMarketplaceFixture, cleanupEligibleMarketplaceFixture } from "./marketplace-fixtures.mjs";
import { ensureRegistryProviderAvatar, resetRegistryProviderToDraft } from "./registry-fixtures.mjs";

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL!;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY!;

test.describe("full provider onboarding lifecycle", () => {
  test.slow();
  test.setTimeout(300_000);

  test("draft → submit → review → reject doc → resubmit → approve → marketplace → suspend", async ({ browser }) => {
    const suffix = Date.now();
    const providerUser = readRegistry().users.find((u: any) => u.key === "provider");
    expect(providerUser).toBeTruthy();

    const providerClient = authenticatedClient("provider");
    const adminClient = authenticatedClient("admin");

    await resetRegistryProviderToDraft(providerUser!.userId);

    const providerContext = await browser.newContext({
      storageState: path.resolve(process.cwd(), "qa/.auth/provider.json"),
    });
    const providerPage = await providerContext.newPage();
    await providerPage.goto("/pro/onboarding");
    await expect(providerPage.getByRole("heading", { name: /provider onboarding|تسجيل مزود/i })).toBeVisible({ timeout: 20_000 });

    const { providerId } = await submitProviderOnboarding(providerUser!.userId, {
      fullName: `QA Flow Provider ${suffix}`,
    });

    const { data: submitted } = await supabaseAdmin.from("providers")
      .select("onboarding_status, submitted_at")
      .eq("id", providerId)
      .single();
    expect(submitted?.onboarding_status).toBe("SUBMITTED");
    expect(submitted?.submitted_at).toBeTruthy();

    await providerPage.goto("/pro/onboarding");
    await expect(providerPage.getByText("123 QA Street")).toBeVisible({ timeout: 20_000 });
    await expect(providerPage.getByText("Ref One")).toBeVisible();
    await expect(providerPage.getByText("Ref Two")).toBeVisible();

    const { error: lockedErr } = await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "Locked One", relationship: "Friend", phone: "+201011111111" },
          { full_name: "Locked Two", relationship: "Neighbor", phone: "+201022222222" },
        ],
      },
    });
    expect(lockedErr).not.toBeNull();

    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "start_review",
    });

    const { data: frontDoc } = await supabaseAdmin.from("provider_documents")
      .select("id")
      .eq("provider_id", providerId)
      .eq("type", "id_card_front")
      .single();
    await adminClient.rpc("admin_review_provider_document", {
      p_document_id: frontDoc!.id,
      p_status: "rejected",
      p_reason: "ID photo is blurry",
    });

    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "doc_rejected",
      p_reason_public: "ID photo is blurry",
    });

    await providerPage.goto("/pro/onboarding");
    await providerPage.waitForLoadState("networkidle");
    const { data: needsChanges } = await supabaseAdmin.from("providers")
      .select("onboarding_status, review_reason_public")
      .eq("id", providerId)
      .single();
    expect(needsChanges).toMatchObject({
      onboarding_status: "NEEDS_CHANGES",
      review_reason_public: "ID photo is blurry",
    });
    await expect(providerPage.getByRole("heading", { name: /provider onboarding|تسجيل مزود/i })).toBeVisible({ timeout: 15_000 });
    await expect(providerPage.getByText(/personal details|البيانات الشخصية/i)).toBeVisible({ timeout: 15_000 });

    await supabaseAdmin.from("provider_documents").update({ status: "pending", rejected_reason: null }).eq("id", frontDoc!.id);
    await providerClient.rpc("provider_submit_onboarding");
    await adminClient.rpc("admin_provider_onboarding_action", { p_provider_id: providerId, p_action: "start_review" });

    const { data: docs } = await supabaseAdmin.from("provider_documents").select("id").eq("provider_id", providerId);
    for (const doc of docs ?? []) {
      await adminClient.rpc("admin_review_provider_document", { p_document_id: doc.id, p_status: "approved" });
    }
    await adminClient.rpc("admin_provider_onboarding_action", { p_provider_id: providerId, p_action: "approve" });

    const { data: approved } = await supabaseAdmin.from("providers")
      .select("onboarding_status, is_verified, is_active")
      .eq("id", providerId)
      .single();
    expect(approved).toMatchObject({ onboarding_status: "APPROVED", is_verified: true, is_active: true });

    await providerPage.goto("/pro");
    await expect(providerPage.getByText(/dashboard|لوحة|bookings/i)).toBeVisible({ timeout: 15_000 });

    const adminContext = await browser.newContext({
      storageState: path.resolve(process.cwd(), "qa/.auth/admin.json"),
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`/admin/provider/${providerId}`);
    await expect(adminPage.getByText("APPROVED", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "suspend",
      p_reason_code: "qa_suspend",
      p_reason_public: "QA suspension in flow test",
    });
    const { data: eligibility } = await supabaseAdmin.rpc("provider_marketplace_eligibility", { p_provider_id: providerId });
    expect((eligibility ?? []).every((row: { is_eligible: boolean }) => !row.is_eligible)).toBe(true);

    await adminClient.rpc("admin_provider_onboarding_action", { p_provider_id: providerId, p_action: "unsuspend" });

    await resetRegistryProviderToDraft(providerUser!.userId);
    await providerContext.close();
    await adminContext.close();
  });

  test("profile photo resolves through signed URL flow", async () => {
    const providerUser = readRegistry().users.find((u: any) => u.key === "provider");
    const storagePath = await ensureRegistryProviderAvatar(providerUser!.userId);

    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const providerClient = authenticatedClient("provider");
    const { data: signed, error } = await providerClient.storage.from("avatars").createSignedUrl(storagePath, 3600);
    expect(error).toBeNull();
    expect(signed?.signedUrl).toMatch(/^https?:\/\//);

    const publicAttempt = anon.storage.from("avatars").getPublicUrl(storagePath);
    expect(publicAttempt.data.publicUrl).toContain("/object/public/");
  });

  test.describe("avatar signed URL regression", () => {
    test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/customer.json") });

    test("provider profile avatar uses signed URL and missing avatar shows placeholder", async ({ page }) => {
      const suffix = Date.now();
      const fixture = await createEligibleMarketplaceFixture(suffix);
      const providerUser = readRegistry().users.find((u: any) => u.key === "provider");
      expect(providerUser).toBeTruthy();
      const storagePath = await ensureRegistryProviderAvatar(providerUser!.userId);

      try {
        await Promise.all([
          page.waitForResponse((response) =>
            response.url().includes("/storage/v1/object/sign/avatars") && response.ok(),
          ),
          page.goto(`/provider/${fixture.provider.id}`),
        ]);
        const avatarImg = page.locator(".h-48 img[src]").first();
        await expect(avatarImg).toBeVisible({ timeout: 20_000 });
        const avatarSrc = await avatarImg.getAttribute("src");
        expect(avatarSrc).toBeTruthy();
        expect(avatarSrc!).toMatch(/^https?:\/\//);
        expect(avatarSrc!).not.toBe(storagePath);
        expect(avatarSrc!).not.toContain(`/provider/${providerUser!.userId}/`);
        const response = await page.request.get(avatarSrc!);
        expect(response.ok()).toBe(true);

        await supabaseAdmin.from("profiles").update({ avatar_url: null }).eq("id", providerUser!.userId);
        await page.reload();
        await page.waitForLoadState("networkidle");
        await expect(page.locator("img[src*='qa-avatar']")).toHaveCount(0);
        await expect(page.locator(`img[src*='${providerUser!.userId}/']`)).toHaveCount(0);
        await expect(page.locator(".h-48 img[src]")).toHaveCount(0);
      } finally {
        await supabaseAdmin.from("profiles").update({ avatar_url: storagePath }).eq("id", providerUser!.userId);
        await cleanupEligibleMarketplaceFixture(fixture);
      }
    });
  });
});

test.describe("Arabic onboarding RTL", () => {
  test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/provider.json") });

  test("Arabic onboarding wizard renders RTL progress", async ({ page }) => {
    await resetRegistryProviderToDraft();
    await page.addInitScript(() => localStorage.setItem("famio.lang", "ar"));
    await page.goto("/pro/onboarding");
    await expect(page.locator("html[dir='rtl']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /تسجيل مزود الخدمة/i })).toBeVisible();
    await expect(page.getByText(/البيانات الشخصية/i)).toBeVisible();
  });

  test("Arabic submitted onboarding screen renders RTL read-only details", async ({ page }) => {
    const providerUser = readRegistry().users.find((u: { key: string }) => u.key === "provider");
    expect(providerUser).toBeTruthy();
    await submitProviderOnboarding(providerUser!.userId);

    await page.addInitScript(() => localStorage.setItem("famio.lang", "ar"));
    await page.goto("/pro/onboarding");
    await expect(page.locator("html[dir='rtl']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByText("123 QA Street")).toBeVisible();
    await expect(page.getByText("Ref One")).toBeVisible();
  });
});
