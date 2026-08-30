import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";
import { supabaseAdmin } from "./admin-client.mjs";
import { addUser, publishE2eFixtureSnapshot, REGISTRY_SCHEMA_VERSION, createEmptyE2eResources } from "./registry.mjs";
import { assertQaE2eBaselineReadOnly } from "./e2e-baseline.mjs";
import { restorePendingRestorations } from "./restoration-registry.mjs";
import { resetRegistryProviderToDraft } from "./tests/registry-fixtures.mjs";
import { vercelBypassHeaders } from "./env.mjs";
import { readQaE2eOtp } from "./read-e2e-otp.mjs";
import { assertQaWriteGuard, validateUiDatabaseAlignment } from "./env-guard.mjs";
import { loadQaEnv } from "./load-qa-env.mjs";
import { recoverRegistryOrphans } from "./orphan-recovery.mjs";
import { findAuthUserByPhone } from "./list-users-paginated.mjs";
import {
  assertRuntimeIdentityMatchesQaGuard,
  fetchRuntimeIdentity,
} from "./runtime-identity-fetch.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { generateSecureRandomPassword } from "./teardown-terminal-disable.mjs";

loadQaEnv({ required: true });
assertQaWriteGuard(process.env);

const AUTH_DIR = path.resolve(process.cwd(), "qa/.auth");
const ANON_STATE_PATH = path.join(AUTH_DIR, "anon.json");

function isVercelLoginWall(text: string): boolean {
  return text.includes("Log in to Vercel");
}

function isFamyLoginPage(text: string): boolean {
  return text.includes("Welcome back")
    || text.includes("Sign in as")
    || text.includes("Send code")
    || text.includes("مرحبًا بعودتك")
    || text.includes("إرسال الرمز");
}

async function pinEnglishLocale(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(() => {
    window.localStorage.setItem("famio.lang", "en");
  });
}

const SIGNUP_TAB = /sign up|إنشاء حساب/i;
const SEND_CODE = /send code|إرسال الرمز/i;
const CUSTOMER_ROLE = /^customer$|^عميل$/i;
const PROVIDER_ROLE = /service provider|مقدم خدمة/i;
const SAVE_PASSWORD = /^save$|^حفظ$/i;

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

async function collectAuthSetupDiagnostics(page: import("@playwright/test").Page, diagnostics: string[]) {
  const url = page.url();
  const visibleError = await page.locator(".text-coral").first().innerText().catch(() => "");
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
  return [
    `url=${url}`,
    `visible_error=${visibleError || "(none)"}`,
    `body=${body.replace(/\d{6}/g, "[REDACTED]")}`,
    ...diagnostics,
  ].join("\n");
}

async function waitForSignupMode(page: import("@playwright/test").Page) {
  const signupTab = page.getByRole("button", { name: SIGNUP_TAB });
  await signupTab.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('input[inputmode="tel"]').click();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await signupTab.click();
    const switched = await page
      .waitForFunction(
        () => /create your famy account|أنشئ حسابك/i.test(document.body.innerText),
        undefined,
        { timeout: 1500 },
      )
      .then(() => true)
      .catch(() => false);
    if (switched) return;
  }

  throw new Error("Signup mode did not activate after repeated tab clicks");
}

async function openLoginInEnglish(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.localStorage.setItem("famio.lang", "en");
  });
  await page.reload({ waitUntil: "load" });
  await page.locator('input[inputmode="tel"]').waitFor({ state: "visible", timeout: 15_000 });
}

async function completeOtpEntry(
  page: import("@playwright/test").Page,
  e164: string,
  purpose: "SIGNUP" | "RESET_PASSWORD",
) {
  await page.waitForURL(/\/otp/, { timeout: 15_000 });
  const code = readQaE2eOtp(e164, purpose);
  await page.getByTestId("otp-input").fill(code);
  await page.waitForURL(/\/auth\/set-password/, { timeout: 15_000 });
}

async function signUp(
  page: import("@playwright/test").Page,
  phone: string,
  role: "customer" | "provider",
  qaPassword: string,
) {
  const e164 = `+20${phone.replace(/^\+/, "")}`;
  const diagnostics: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") diagnostics.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => diagnostics.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 || url.includes("sendOtp") || url.includes("_serverFn")) {
      diagnostics.push(`response: ${response.status()} ${response.request().method()} ${url}`);
    }
  });

  await openLoginInEnglish(page);
  await waitForSignupMode(page);
  await page.getByRole("button", { name: role === "provider" ? PROVIDER_ROLE : CUSTOMER_ROLE }).click();
  await page.locator('input[inputmode="tel"]').fill(phone);

  const otpNavigation = page.waitForURL(/\/otp/, { timeout: 15_000 });
  await page.getByRole("button", { name: SEND_CODE }).click();
  try {
    await otpNavigation;
  } catch (error) {
    throw new Error(`Signup did not reach /otp for ${role}:\n${await collectAuthSetupDiagnostics(page, diagnostics)}\n${(error as Error).message}`);
  }

  await completeOtpEntry(page, e164, "SIGNUP");
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill(qaPassword);
  await passwordInputs.nth(1).fill(qaPassword);
  await page.getByRole("button", { name: SAVE_PASSWORD }).click();
}

async function globalSetup(config: FullConfig) {
  process.env.QA_E2E_OTP_CAPTURE = "1";
  const baseURL = config.projects[0].use.baseURL as string;
  validateUiDatabaseAlignment({
    playwrightBaseUrl: baseURL,
    qaSupabaseUrl: process.env.QA_SUPABASE_URL,
    viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
    qaAppOrigin: process.env.FAMY_QA_APP_ORIGIN,
    productionAppOrigin: process.env.FAMY_PRODUCTION_APP_ORIGIN,
  });

  const runtimeIdentity = await fetchRuntimeIdentity(baseURL, vercelBypassHeaders());
  assertRuntimeIdentityMatchesQaGuard(
    runtimeIdentity,
    parseSupabaseProjectRef(process.env.QA_SUPABASE_URL!),
  );

  // Recover global rows first if a prior browser/worker process was interrupted.
  await restorePendingRestorations();
  // Recover registry-tracked orphans from interrupted prior runs before minting new users.
  await recoverRegistryOrphans();

  await assertQaE2eBaselineReadOnly(supabaseAdmin);

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await bootstrapVercelBypassStorage(baseURL);

  const contextOptions: Parameters<typeof browser.newContext>[0] = { baseURL };
  const bypassHeaders = vercelBypassHeaders();
  if (bypassHeaders) {
    contextOptions.storageState = ANON_STATE_PATH;
    contextOptions.extraHTTPHeaders = bypassHeaders;
  }
  const browser = await chromium.launch();

  const qaPassword = generateSecureRandomPassword();
  const runId = String(Date.now());
  let reg: {
    schemaVersion: number;
    users: any[];
    qaPassword: string;
    phones: typeof QA_PHONES;
    e2eSnapshot: {
      runId,
      publishedAt: string | null;
      requiredKeys: string[];
      userIds: string[];
      resources: ReturnType<typeof createEmptyE2eResources>;
    };
  } = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    users: [],
    qaPassword,
    phones: QA_PHONES,
    e2eSnapshot: {
      runId,
      publishedAt: null,
      requiredKeys: ["customer", "provider", "adminSeed"],
      userIds: [],
      resources: createEmptyE2eResources(),
    },
  };

  try {
    // ---- QA customer ----
    {
      const ctx = await browser.newContext(contextOptions);
      await pinEnglishLocale(ctx);
      const page = await ctx.newPage();
      await signUp(page, QA_PHONES.customer, "customer", qaPassword);
      await page.waitForURL(/\/(setup|home)/, { timeout: 15_000 });
      await ctx.storageState({ path: path.join(AUTH_DIR, "customer.json") });
      await ctx.close();
    }

    // ---- QA provider (baseline, not yet eligible) ----
    {
      const ctx = await browser.newContext(contextOptions);
      await pinEnglishLocale(ctx);
      const page = await ctx.newPage();
      await signUp(page, QA_PHONES.provider, "provider", qaPassword);
      await page.waitForURL(/\/pro\/onboarding/, { timeout: 15_000 });
      await page.getByText(/personal details|البيانات الشخصية/i).waitFor({ state: "visible", timeout: 15_000 }).catch(async (error) => {
        const body = (await page.locator("body").innerText().catch(() => "<unavailable>" )).slice(0, 1000);
        throw new Error(`Provider onboarding did not render at ${page.url()}: ${body}\n${error.message}`);
      });
      await ctx.storageState({ path: path.join(AUTH_DIR, "provider.json") });
      await ctx.close();
    }

    // ---- QA admin: sign up as a plain customer, then elevate via direct
    // DB grant — there is no self-serve "become admin" UI by design, so a
    // service-role role grant IS the real operational path for this step. ----
    {
      const ctx = await browser.newContext(contextOptions);
      await pinEnglishLocale(ctx);
      const page = await ctx.newPage();
      await signUp(page, QA_PHONES.adminSeed, "customer", qaPassword);
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
    const u = await findAuthUserByPhone(supabaseAdmin, e164);
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

  const providerEntry = reg.users.find((u) => u.key === "provider");
  if (providerEntry) {
    await resetRegistryProviderToDraft(providerEntry.userId);
  }

  publishE2eFixtureSnapshot(reg);
}

export default globalSetup;
