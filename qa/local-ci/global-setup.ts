import { chromium, expect, type FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createClient, type Session } from "@supabase/supabase-js";
import { loadLocalCiEnv, supabaseAuthStorageKey } from "./env.mjs";
import { LOCAL_CI_PASSWORD, LOCAL_CI_STATE_DIR, LOCAL_CI_USERS } from "./fixtures.mjs";
import { totpCode, totpWindowRemainingMs } from "./totp.mjs";
import { stubExternalNetwork } from "./stub-network";

loadLocalCiEnv();

const STATE_DIR = path.resolve(LOCAL_CI_STATE_DIR);
const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL!;

export function statePath(name: string) {
  return path.join(STATE_DIR, `${name}.json`);
}

function storageStateFor(baseURL: string, session: Session | null) {
  const origin = new URL(baseURL).origin;
  const localStorage = [{ name: "famio.lang", value: "ar" }];
  if (session) {
    localStorage.push({ name: supabaseAuthStorageKey(SUPABASE_URL), value: JSON.stringify(session) });
  }
  return {
    cookies: [
      {
        name: "famio_lang",
        value: "ar",
        domain: new URL(baseURL).hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [{ origin, localStorage }],
  };
}

async function passwordSession(email: string): Promise<Session> {
  const client = createClient(SUPABASE_URL, process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_CI_PASSWORD });
  if (error || !data.session) throw new Error(`[local-ci] sign-in failed for a seeded user: ${error?.message}`);
  return data.session;
}

/** The admin passes the real TOTP screen once; later admin tests reuse that aal2 session. */
async function adminWithSecondFactor(baseURL: string) {
  const seed = JSON.parse(fs.readFileSync(statePath("seed"), "utf8")) as {
    adminTotpSecret: string;
    adminTotpWindow: number;
  };
  const session = await passwordSession(LOCAL_CI_USERS.admin.email);
  const browser = await chromium.launch(
    process.env.LOCAL_CI_CHROMIUM_PATH ? { executablePath: process.env.LOCAL_CI_CHROMIUM_PATH } : undefined,
  );
  try {
    const context = await browser.newContext({
      baseURL,
      locale: "ar-EG",
      timezoneId: "Africa/Cairo",
      storageState: storageStateFor(baseURL, session),
    });
    await stubExternalNetwork(context);
    const page = await context.newPage();
    await page.goto("/admin");
    const codeInput = page.getByLabel("رمز التحقق");
    await expect(codeInput).toBeVisible({ timeout: 30_000 });
    // TOTP codes are single-use per 30 s window: if the seed verified in this
    // window, the next code is the first one the admin could type anyway.
    if (Math.floor(Date.now() / 30_000) === seed.adminTotpWindow) {
      await page.waitForTimeout(totpWindowRemainingMs() + 250);
    }
    await codeInput.fill(totpCode(seed.adminTotpSecret));
    await page.getByRole("button", { name: "تأكيد" }).click();
    await expect(page.getByRole("heading", { name: "النهارده" })).toBeVisible({ timeout: 30_000 });
    await context.storageState({ path: statePath("admin") });
    await context.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(statePath("seed"))) {
    throw new Error("[local-ci] qa/.auth/local-ci/seed.json is missing. Run: node qa/local-ci/seed.mjs");
  }
  fs.writeFileSync(statePath("anon"), JSON.stringify(storageStateFor(baseURL, null)));
  fs.writeFileSync(
    statePath("customer"),
    JSON.stringify(storageStateFor(baseURL, await passwordSession(LOCAL_CI_USERS.customer.email))),
  );
  fs.writeFileSync(
    statePath("parentNoDob"),
    JSON.stringify(storageStateFor(baseURL, await passwordSession(LOCAL_CI_USERS.parentNoDob.email))),
  );
  fs.writeFileSync(
    statePath("tutor"),
    JSON.stringify(storageStateFor(baseURL, await passwordSession(LOCAL_CI_USERS.tutor.email))),
  );
  await adminWithSecondFactor(baseURL);
}
