import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("account deletion wallet forfeit", () => {
  it("requires confirm flag, forfeits wallet, and records audit", async () => {
  const forfeitCustomer = "00000000-0000-0000-0000-0000000000f1";
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES ('${forfeitCustomer}', '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.profiles (id, full_name, locale, phone)
    VALUES ('${forfeitCustomer}', 'Wallet Forfeit User', 'ar', '201088877766')
    ON CONFLICT (id) DO NOTHING;
  `);

    await asServiceRole(db, () =>
      db.query(
        `SELECT public.customer_wallet_insert_entry(
           $1, 'credit', 12.5, 'admin_credit', NULL, NULL, NULL, 'forfeit-test-credit', '{}'::jsonb
         )`,
        [forfeitCustomer],
      ),
    );

    const check = await tryAsUser(
      db,
      forfeitCustomer,
      "SELECT public.account_deletion_check() AS payload",
    );
    expect(check.error).toBeUndefined();
    expect(check.rows?.[0]?.payload).toMatchObject({
      ok: true,
      wallet_forfeit_amount: 12.5,
    });

    await expect(
      asServiceRole(db, () =>
        db.query(`SELECT public.anonymize_account($1::uuid, false)`, [forfeitCustomer]),
      ),
    ).rejects.toThrow(/wallet_forfeit_confirm_required/);

    await asServiceRole(db, () =>
      db.query(`SELECT public.anonymize_account($1::uuid, true)`, [forfeitCustomer]),
    );

    const balance = await queryRows<{ available: string }>(
      db,
      `SELECT available_amount::text AS available FROM public.customer_wallet_balances($1)`,
      [forfeitCustomer],
    );
    expect(Number(balance[0]?.available ?? -1)).toBeLessThan(0.01);

    const ledger = await queryRows<{ reason: string; amount: string }>(
      db,
      `SELECT reason, amount::text AS amount FROM public.customer_wallet_entries
       WHERE customer_id = $1 AND reason = 'forfeited_on_deletion'`,
      [forfeitCustomer],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amount).toBe("12.50");

    const audit = await queryRows<{ new_values: { wallet_balance_forfeited?: number } }>(
      db,
      `SELECT new_values FROM public.audit_logs
       WHERE entity_id = $1 AND action = 'account_anonymized'
       ORDER BY created_at DESC LIMIT 1`,
      [forfeitCustomer],
    );
    expect(Number(audit[0]?.new_values?.wallet_balance_forfeited ?? 0)).toBe(12.5);
  });
});