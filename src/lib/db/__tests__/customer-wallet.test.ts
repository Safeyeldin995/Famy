import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;
let providerReason: string;

const cancelAs = (user: string, bookingId: string) =>
  tryAsUser(db, user, "SELECT public.cancel_booking($1, $2, NULL)", [bookingId, providerReason]);

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  const reasons = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency'",
  );
  providerReason = reasons[0]!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function paidConfirmedBooking() {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
    `),
  );
  const amount = await queryRows<{ a: string }>(
    db,
    "SELECT amount::text AS a FROM public.payments WHERE id = $1",
    [paymobId],
  );
  return { bookingId, paymobId, amount: Number(amount[0]!.a) };
}

describe("customer wallet — provider cancel", () => {
  it("credits the wallet exactly once when the provider cancels a paid booking", async () => {
    const { bookingId, amount } = await paidConfirmedBooking();
    const first = await cancelAs(IDS.providerUser, bookingId);
    expect(first.error).toBeUndefined();

    const entries = await queryRows<{ count: string; sum: string }>(
      db,
      `SELECT count(*)::text AS count, coalesce(sum(amount), 0)::text AS sum
       FROM public.customer_wallet_entries
       WHERE booking_id = $1 AND reason = 'provider_cancelled'`,
      [bookingId],
    );
    expect(entries[0]?.count).toBe("1");
    expect(Number(entries[0]?.sum)).toBe(amount);

    await asServiceRole(db, () =>
      db.query("SELECT public.credit_customer_wallet_provider_cancelled($1)", [bookingId]),
    );
    const again = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM public.customer_wallet_entries WHERE booking_id = $1`,
      [bookingId],
    );
    expect(again[0]?.count).toBe("1");

    const provider = await queryRows<{ c: string }>(
      db,
      "SELECT paid_booking_cancellations::text AS c FROM public.providers WHERE id = $1",
      [IDS.provider],
    );
    expect(Number(provider[0]?.c)).toBe(1);
  });
});

describe("customer wallet — admin adjustments", () => {
  it("prevents debits that would make the balance negative", async () => {
    const before = await tryAsUser(
      db,
      IDS.customer,
      "SELECT available_amount::text AS available FROM public.customer_wallet_balances()",
    );
    const start = Number(before.rows?.[0]?.available ?? 0);
    const topUp = 25;

    const credit = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', $2, $3, NULL)",
      [IDS.customer, topUp, "test credit"],
    );
    expect(credit.error).toBeUndefined();

    const debit = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'debit', $2, $3, NULL)",
      [IDS.customer, start + topUp + 1, "test over-debit"],
    );
    expect(debit.error).toBeDefined();

    const available = await tryAsUser(
      db,
      IDS.customer,
      "SELECT available_amount::text AS available FROM public.customer_wallet_balances()",
    );
    expect(Number(available.rows?.[0]?.available)).toBe(start + topUp);
  });
});