import { test as base, expect, type Browser, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadLocalCiEnv } from "../env.mjs";
import { LOCAL_CI_STATE_DIR } from "../fixtures.mjs";
import { stubExternalNetwork } from "../stub-network";
import { captureErrors } from "../../tests/helpers";

loadLocalCiEnv();

export type Role = "anon" | "customer" | "parentNoDob" | "tutor" | "admin";

export type SeedReport = {
  users: { admin: string; customer: string; tutor: string; parentNoDob: string };
  providerId: string;
  serviceId: string;
  childId: string;
  bookings: Record<"upcoming_paid" | "held_review", { bookingId: string; paymentId: string }>;
  walletBalance: number;
};

export const seed: SeedReport = JSON.parse(
  fs.readFileSync(path.resolve(LOCAL_CI_STATE_DIR, "seed.json"), "utf8"),
);

export function storageStateFor(role: Role) {
  return path.resolve(LOCAL_CI_STATE_DIR, `${role}.json`);
}

/** Service-role client on the local stack, for setup checks and DB assertions only. */
export const db: SupabaseClient = createClient(
  process.env.LOCAL_SUPABASE_URL!,
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function walletBalance(customerId: string): Promise<number> {
  const { data, error } = await db
    .from("customer_wallet_entries")
    .select("direction, amount")
    .eq("customer_id", customerId);
  if (error) throw error;
  return (data ?? []).reduce(
    (sum, row) => sum + (row.direction === "credit" ? 1 : -1) * Number(row.amount),
    0,
  );
}

/** A page signed in as `role`, with external hosts stubbed and errors captured. */
export async function openAs(browser: Browser, role: Role) {
  const context = await browser.newContext({ storageState: storageStateFor(role) });
  const stubbedHosts = new Set<string>();
  await stubExternalNetwork(context, stubbedHosts);
  const page = await context.newPage();
  const errors = captureErrors(page);
  return { context, page, errors, stubbedHosts };
}

export function expectNoErrors(errors: ReturnType<typeof captureErrors>) {
  const { console: consoleErrors, network } = errors.readErrors();
  expect.soft(network, "no failed requests").toEqual([]);
  expect(consoleErrors, "no console errors").toEqual([]);
}

type Fixtures = { errors: ReturnType<typeof captureErrors>; stubbedHosts: Set<string> };

/** Default `page` is anonymous (or the role set with test.use({ storageState })). */
export const test = base.extend<Fixtures>({
  stubbedHosts: async ({}, use) => {
    await use(new Set<string>());
  },
  context: async ({ context, stubbedHosts }, use) => {
    await stubExternalNetwork(context, stubbedHosts);
    await use(context);
  },
  errors: async ({ page }, use) => {
    await use(captureErrors(page));
  },
});

export { expect };
export type { Page };
