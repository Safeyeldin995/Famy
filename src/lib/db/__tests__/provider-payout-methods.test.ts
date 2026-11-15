import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createProviderLifecycleDb,
  IDS,
  queryRows,
  seedDraftProvider,
  tryAsAnon as anonRaw,
  tryAsUser as userRaw,
} from "./provider-lifecycle.harness";

let db: PGlite;

// The harness switches roles with savepoints, so each call runs in its own transaction.
async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    return await fn();
  } finally {
    await db.exec("COMMIT");
  }
}
const tryAsUser = (_db: PGlite, user: string, sql: string) => inTx(() => userRaw(db, user, sql));
const tryAsAnon = (_db: PGlite, sql: string) => inTx(() => anonRaw(db, sql));

const insert = (fields: string, values: string) =>
  `INSERT INTO public.provider_payout_methods (provider_id, ${fields}) VALUES ('${IDS.provider}', ${values}) RETURNING id`;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
  await seedDraftProvider(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("provider_payout_methods", () => {
  it("lets a provider add their own methods, with field rules per method", async () => {
    const wallet = await tryAsUser(
      db,
      IDS.providerUser,
      insert(
        "method, holder_name, wallet_phone, is_default",
        "'vodafone_cash', 'Mona Ali', '01012345678', true",
      ),
    );
    expect(wallet.error).toBeUndefined();

    const bank = await tryAsUser(
      db,
      IDS.providerUser,
      insert(
        "method, holder_name, bank_name, account_number",
        "'bank', 'Mona Ali', 'NBE', 'EG380019000500000000263180002'",
      ),
    );
    expect(bank.ok).toBe(true);

    const badPhone = await tryAsUser(
      db,
      IDS.providerUser,
      insert("method, holder_name, wallet_phone", "'orange_cash', 'Mona Ali', '0131234567'"),
    );
    expect(badPhone.ok).toBe(false);

    const mixedFields = await tryAsUser(
      db,
      IDS.providerUser,
      insert(
        "method, holder_name, wallet_phone, bank_name",
        "'etisalat_cash', 'Mona Ali', '01112345678', 'NBE'",
      ),
    );
    expect(mixedFields.ok).toBe(false);

    const secondDefault = await tryAsUser(
      db,
      IDS.providerUser,
      insert(
        "method, holder_name, instapay_address, is_default",
        "'instapay', 'Mona Ali', 'mona@instapay', true",
      ),
    );
    expect(secondDefault.ok).toBe(false);
  });

  it("hides methods from other providers, customers and guests; admin can read only", async () => {
    const own = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT id FROM public.provider_payout_methods",
    );
    expect(own.rows?.length).toBe(2);

    for (const user of [IDS.otherProviderUser, IDS.customer]) {
      const r = await tryAsUser(db, user, "SELECT id FROM public.provider_payout_methods");
      expect(r.ok).toBe(true);
      expect(r.rows?.length).toBe(0);
    }
    const otherWrite = await tryAsUser(
      db,
      IDS.otherProviderUser,
      insert("method, holder_name, wallet_phone", "'vodafone_cash', 'Thief', '01099999999'"),
    );
    expect(otherWrite.ok).toBe(false);

    expect((await tryAsAnon(db, "SELECT id FROM public.provider_payout_methods")).ok).toBe(false);

    await db.exec(
      `INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.adminUser}', 'admin') ON CONFLICT DO NOTHING`,
    );
    const admin = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT id FROM public.provider_payout_methods",
    );
    expect(admin.rows?.length).toBe(2);
    const adminUpdate = await tryAsUser(
      db,
      IDS.adminUser,
      "UPDATE public.provider_payout_methods SET holder_name = 'Changed' RETURNING id",
    );
    expect(adminUpdate.rows?.length ?? 0).toBe(0);
  });

  it("audits every change to where money is sent", async () => {
    const rows = await queryRows<{ n: number }>(
      db,
      "SELECT count(*)::int AS n FROM public.audit_logs WHERE entity = 'provider_payout_methods'",
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
