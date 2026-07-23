import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";
import { supabaseAdmin } from "./admin-client.mjs";
import { addUser, writeRegistry } from "./registry.mjs";
import { restorePendingRestorations } from "./restoration-registry.mjs";
import { loadEnv, vercelBypassHeaders } from "./env.mjs";
import { readQaE2eOtp } from "./read-e2e-otp.mjs";

loadEnv();

const AUTH_DIR = path.resolve(process.cwd(), "qa/.auth");
const ANON_STATE_PATH = path.join(AUTH_DIR, "anon.json");
const QA_PASSWORD = "QaRuntime!2026Test";

function isVercelLoginWall(text: string): boolean {
  return text.includes("Log in to Vercel");
}

function isFamyLoginPage(text: string): boolean {
  return text.includes("Welcome back") || text.includes("Sign in as") || text.includes("Send code");
}

/** Bootstrap Vercel Deployment Protection bypass cookies into qa/.auth/anon.json. */
export async function bootstrapVercelBypassStorage(baseURL: string): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const bypassHeaders = vercelBypassHeaders();

  if (!bypassHeaders) {
    if (!fs.existsSync(ANON_STATE_PATH)) {
      fs.writeFileSync(ANON_STATE_PATH, JSON.stringify({ cookies: [], origins: [] }));
    }
    return;
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: bypassHeaders,
    });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      const text = await page.locator("body").innerText();
      if (isVercelLoginWall(text) || !isFamyLoginPage(text)) {
        throw new Error("Vercel deployment protection bypass did not reach the Famy application.");
      }
      await context.storageState({ path: ANON_STATE_PATH });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

/** Lightweight access check used after harness changes; never prints secrets. */
export async function runVercelBypassAccessCheck(baseURL: string): Promise<{
  pass: boolean;
  reachedFamyLogin: boolean;
  vercelLoginWall: boolean;
}> {
  await bootstrapVercelBypassStorage(baseURL);

  if (!vercelBypassHeaders()) {
    return { pass: true, reachedFamyLogin: true, vercelLoginWall: false };
  }

  if (!fs.existsSync(ANON_STATE_PATH)) {
    return { pass: false, reachedFamyLogin: false, vercelLoginWall: true };
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      storageState: ANON_STATE_PATH,
    });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      const text = await page.locator("body").innerText();
      const vercelLoginWall = isVercelLoginWall(text);
      const reachedFamyLogin = isFamyLoginPage(text);
      return { pass: !vercelLoginWall && reachedFamyLogin, reachedFamyLogin, vercelLoginWall };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

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

async function completeOtpEntry(
  page: import("@playwright/test").Page,
  e164: string,
  purpose: "SIGNUP" | "RESET_PASSWORD",
) {
  await page.waitForURL(/\/otp/, { timeout: 15_000 });
  const code = readQaE2eOtp(e164, purpose);
  const inputs = page.locator('input[inputmode="numeric"]');
  for (let i = 0; i < 6; i++) {
    await inputs.nth(i).fill(code[i] ?? "");
  }
  await page.waitForURL(/\/auth\/set-password/, { timeout: 15_000 });
}

async function signUp(page: import("@playwright/test").Page, phone: string, role: "customer" | "provider") {
  const e164 = `+20${phone.replace(/^\+/, "")}`;
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800); // let React hydrate before the first click
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("button", { name: role === "provider" ? /service provider/i : /^customer$/i }).click();
  await page.locator('input[inputmode="tel"]').fill(phone);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await completeOtpEntry(page, e164, "SIGNUP");
  await page.locator('input[type="password"]').fill(QA_PASSWORD);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function globalSetup(config: FullConfig) {
  process.env.QA_E2E_OTP_CAPTURE = "1";
  // Recover global rows first if a prior browser/worker process was interrupted.
  await restorePendingRestorations();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const baseURL = config.projects[0].use.baseURL as string;
  await bootstrapVercelBypassStorage(baseURL);

  const contextOptions = {
    baseURL,
    storageState: ANON_STATE_PATH,
  };
  const browser = await chromium.launch();

  // Always start from a clean registry: each run mints fresh QA_ accounts
  // (timestamp-suffixed phones), so a prior run's entries are guaranteed stale.
  let reg: { users: any[]; qaPassword?: string; phones?: typeof QA_PHONES } = { users: [] };
  reg.qaPassword = QA_PASSWORD;
  reg.phones = QA_PHONES;
  writeRegistry(reg);

  try {
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
      const diagnostics: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") diagnostics.push(`console: ${message.text()}`); });
      page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
      page.on("requestfailed", (request) => diagnostics.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
      page.on("response", (response) => { if (response.status() >= 400) diagnostics.push(`response: ${response.status()} ${response.request().method()} ${response.url()}`); });
      await signUp(page, QA_PHONES.provider, "provider");
      await page.waitForURL(/\/pro\/onboarding/, { timeout: 15_000 });
      await page.locator("textarea").first().waitFor({ state: "visible", timeout: 15_000 }).catch(async (error) => {
        const body = (await page.locator("body").innerText().catch(() => "<unavailable>" )).slice(0, 1000);
        throw new Error(`Provider onboarding did not render at ${page.url()}: ${body}\n${diagnostics.join("\n")}\n${error.message}`);
      });
      await page.getByLabel(/english bio|bio.*english/i).fill("QA_ automated test provider bio.").catch(async () => {
        await page.locator("textarea").first().fill("QA_ automated test provider bio.");
      });
      await page.getByLabel(/years|experience/i).fill("2").catch(async () => {
        await page.locator('input[type="number"]').first().fill("2");
      });
      await page.getByLabel(/rate|price/i).fill("100").catch(async () => {
        await page.locator('input[type="number"]').nth(1).fill("100");
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
  } finally {
    await browser.close();
  }

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

  const customerEntry = reg.users.find((u: any) => u.key === "customer");
  if (customerEntry) {
    const { error } = await supabaseAdmin.from("addresses").insert({
      user_id: customerEntry.userId,
      label: "home",
      city: "Cairo",
      area: "QA_ Marketplace Area",
      street: "QA_ Marketplace Street",
      line1: "QA_ Marketplace Street",
      lat: 30.01,
      lng: 31.02,
      is_default: true,
    });
    if (error) throw new Error(`Failed to create QA Customer marketplace address: ${error.message}`);
  }
}

export default globalSetup;
