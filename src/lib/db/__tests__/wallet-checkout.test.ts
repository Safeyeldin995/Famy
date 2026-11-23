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

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("customer_apply_wallet_at_checkout", { concurrent: false }, () => {
  it("debits wallet idempotently and reduces the card amount", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const topUp = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 40, 'test top-up', NULL)",
      [IDS.customer],
    );
    expect(topUp.error).toBeUndefined();
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const available = await tryAsUser(
      db,
      IDS.customer,
      "SELECT available_amount::text AS available FROM public.customer_wallet_balances()",
    );
    expect(Number(available.rows?.[0]?.available)).toBeGreaterThanOrEqual(40);

    const first = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid) AS payload",
      [paymobId],
    );
    expect(first.error).toBeUndefined();
    const walletSpent = (first.rows?.[0]?.payload as { wallet_spent?: number })?.wallet_spent;
    expect(Number(walletSpent)).toBeGreaterThan(0);
    const second = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid)",
      [paymobId],
    );
    expect(second.error).toBeUndefined();

    const payment = await queryRows<{ amount: string; meta: string }>(
      db,
      "SELECT amount::text AS amount, metadata::text AS meta FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(Number(payment[0]?.amount)).toBeLessThan(500);

    const debits = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM public.customer_wallet_entries
       WHERE idempotency_key = $1`,
      [`checkout_spend:${paymobId}`],
    );
    expect(debits[0]?.count).toBe("1");
  });

  it("captures payment without Paymob when wallet covers the total", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const due = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const topUp = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', $2, 'test top-up', NULL)",
      [IDS.customer, Number(due[0]?.due ?? 500) * 2 + 1000],
    );
    expect(topUp.error).toBeUndefined();
    const applied = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid) AS payload",
      [paymobId],
    );
    expect(applied.error).toBeUndefined();
    expect(
      (applied.rows?.[0]?.payload as { paid_via_wallet_only?: boolean })?.paid_via_wallet_only,
    ).toBe(true);

    const payment = await queryRows<{ status: string }>(
      db,
      "SELECT status::text AS status FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(payment[0]?.status).toBe("captured");
  });
});

describe("provider payout hold after lesson report", () => {
  it("reduces payable balance when an open report credits exist", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "completed" });
    await asServiceRole(db, () =>
      db.exec(`
        INSERT INTO public.online_lesson_issue_reports (
          booking_id, reported_by, reporter_role, category, description, status
        ) VALUES (
          '${bookingId}', '${IDS.customer}', 'customer', 'behavior',
          'Provider behavior was inappropriate during the online lesson.', 'open'
        );
        UPDATE public.bookings SET provider_payout_held = true WHERE id = '${bookingId}';
      `),
    );

    await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.ledger_insert_entry(
        $1, $2, 'online_provider_share', 'credit', 120, 'online', NULL, $3, NULL)`,
      [IDS.provider, bookingId, IDS.adminUser],
    );
    const creditAmount = 120;

    const over = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_record_provider_payout($1, $2, 'TR-HOLD', 'payout')",
      [IDS.provider, creditAmount],
    );
    expect(over.ok).toBe(false);
  });
});

describe("wallet refund settlement", () => {
  it("blocks admin_record_payment_refund after provider-cancel wallet credit", async () => {
    const { bookingId, paymobId } = await (async () => {
      const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
      const { paymobId } = await seedPaymentsForBooking(db, bookingId);
      await asServiceRole(db, () =>
        db.exec(`
          SELECT set_config('app.ledger_internal_capture', 'on', true);
          UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
        `),
      );
      return { bookingId, paymobId };
    })();

    const reasons = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency'",
    );
    await tryAsUser(db, IDS.providerUser, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      reasons[0]!.id,
    ]);

    const refund = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_record_payment_refund($1, 'REF-DUP')",
      [paymobId],
    );
    expect(refund.error).toBeDefined();
  });
});