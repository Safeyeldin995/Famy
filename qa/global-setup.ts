import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";
import { supabaseAdmin } from "./admin-client.mjs";
import { addUser, writeRegistry } from "./registry.mjs";
import { restorePendingRestorations } from "./restoration-registry.mjs";

const AUTH_DIR = path.resolve(process.cwd(), "qa/.auth");
const QA_PASSWORD = "QaRuntime!2026Test";

// Deterministic-but-unique-per-run QA phone numbers (Egyptian-shaped E.164 after
// the app's normalizePhone()). Never real numbers; OTP is disabled pre-launch
// so no SMS is ever attempted against them.
const runSuffix = Date.now().toString().slice(-6);
export const QA_PHONES = {
  customer: `10${runSuffix}01`,
  provider: `10${runSuffix}02`,
  adminSeed: `10${runSuffix}03`,
  eligibleProvider: `10${runSuffix}04`,
};

async function signUp(page: import("@playwright/test").Page, phone: string, role: "customer" | "provider") {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const loginPath = bypassSecret
    ? `/login?x-vercel-protection-bypass=${encodeURIComponent(bypassSecret)}&x-vercel-set-bypass-cookie=true`
    : "/login";
  await page.goto(loginPath);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800); // let React hydrate before the first click
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("button", { name: role === "provider" ? /service provider/i : /^customer$/i }).click();
  await page.locator('input[inputmode="tel"]').fill(phone);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/auth\/set-password/, { timeout: 15_000 });
  await page.locator('input[type="password"]').fill(QA_PASSWORD);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function globalSetup(config: FullConfig) {
  // Recover global rows first if a prior browser/worker process was interrupted.
  await restorePendingRestorations();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const baseURL = config.projects[0].use.baseURL as string;
  const contextOptions = { baseURL };
  const browser = await chromium.launch();

  // Always start from a clean registry: each run mints fresh QA_ accounts
  // (timestamp-suffixed phones), so a prior run's entries are guaranteed stale.
  let reg: { users: any[]; qaPassword?: string; phones?: typeof QA_PHONES } = { users: [] };
  reg.qaPassword = QA_PASSWORD;
  reg.phones = QA_PHONES;
  writeRegistry(reg);

  // ---- QA customer ----
  {
    const ctx = await browser.newContext(contextOptions);
    const page = await ctx.newPage();
    await signUp(page, QA_PHONES.customer, "customer");
    await page.waitForURL(/\/(setup|home)/, { timeout: 15_000 });
    await ctx.storageState({ path: path.join(AUTH_DIR, "customer.json") });
    await ctx.close();
  }

  // ---- QA provider (baseline, not yet eligible) ----
  {
    const ctx = await browser.newContext(contextOptions);
    const page = await ctx.newPage();
    await signUp(page, QA_PHONES.provider, "provider");
    await page.waitForURL(/\/pro\/onboarding/, { timeout: 15_000 });
    await page.getByLabel(/english bio|bio.*english/i).fill("QA_ automated test provider bio.").catch(async () => {
      await page.locator("textarea").first().fill("QA_ automated test provider bio.");
    });
    // Pick the first enabled city option (label text is data-driven from admin settings).
    await page.locator("text=/./").first();
    const cityButtons = page.locator("button", { hasText: /.+/ });
    await page.waitForTimeout(500); // settings query to populate city buttons
    const cityCandidates = page.locator("div.grid.grid-cols-2 > button");
    if (await cityCandidates.count() > 0) {
      await cityCandidates.first().click();
    }
    await page.getByRole("button", { name: /continue|creating/i }).click();
    await page.waitForURL(/\/pro\/documents|\/pro$/, { timeout: 15_000 }).catch(() => {});
    await ctx.storageState({ path: path.join(AUTH_DIR, "provider.json") });
    await ctx.close();
  }

  // ---- QA admin: sign up as a plain customer, then elevate via direct
  // DB grant — there is no self-serve "become admin" UI by design, so a
  // service-role role grant IS the real operational path for this step. ----
  {
    const ctx = await browser.newContext(contextOptions);
    const page = await ctx.newPage();
    await signUp(page, QA_PHONES.adminSeed, "customer");
    await page.waitForURL(/\/(setup|home)/, { timeout: 15_000 });
    await ctx.storageState({ path: path.join(AUTH_DIR, "admin.json") });
    await ctx.close();
  }

  await browser.close();

  // Resolve user ids + tag profiles as QA_ for identification, using service role.
  for (const [key, phone] of Object.entries(QA_PHONES)) {
    const e164 = `+20${phone}`;
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = data.users.find((u) => u.phone === e164.replace("+", "") || u.phone === e164);
    if (u) {
      await supabaseAdmin.from("profiles").update({ full_name: `QA_${key}_e2e` }).eq("id", u.id);
      reg = addUser(reg, { key, userId: u.id, phone: e164 });
    }
  }

  // Grant admin role to the admin-seed account.
  const adminEntry = reg.users.find((u: any) => u.key === "adminSeed");
  if (adminEntry) {
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: adminEntry.userId, role: "admin" }, { onConflict: "user_id,role" });
    if (error) throw new Error(`Failed to grant QA admin role: ${error.message}`);
  }
}

export default globalSetup;
