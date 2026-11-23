import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  cancellationReasonFor,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;

describe("wallet checkout database", { concurrent: false }, () => {
beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("customer_apply_wallet_at_checkout", () => {
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

  it("restore_customer_wallet_checkout_debit credits back a pending Paymob wallet spend", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 40, 'test top-up', NULL)",
      [IDS.customer],
    );
    const applied = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid)",
      [paymobId],
    );
    expect(applied.error).toBeUndefined();
    const restored = await asServiceRole(db, () =>
      db.query(`SELECT public.restore_customer_wallet_checkout_debit($1::uuid)`, [bookingId]),
    );
    expect(restored).toBeDefined();
    const release = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM public.customer_wallet_entries
       WHERE idempotency_key = $1`,
      [`checkout_release:${paymobId}`],
    );
    expect(release[0]?.count).toBe("1");
    const funded = await queryRows<{ total: string }>(
      db,
      `SELECT public.payment_checkout_funded_total(p.*)::text AS total
       FROM public.payments p WHERE id = $1`,
      [paymobId],
    );
    const meta = await queryRows<{ released: string }>(
      db,
      `SELECT metadata->>'wallet_checkout_released' AS released FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(Number(meta[0]?.released)).toBeGreaterThan(0);
    const cardDue = await queryRows<{ amount: string; checkout_total: string }>(
      db,
      `SELECT amount::text AS amount, metadata->>'checkout_total' AS checkout_total
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(Number(funded[0]?.total)).toBeCloseTo(Number(cardDue[0]?.amount), 2);
    expect(Number(funded[0]?.total)).toBeLessThan(Number(cardDue[0]?.checkout_total ?? 500));
  });

  it("customer cancel releases wallet debit when checkout stays pending", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 40, 'test top-up', NULL)",
      [IDS.customer],
    );
    await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid)",
      [paymobId],
    );
    const customerReason = await cancellationReasonFor(db, "customer", ["confirmed"]);
    const cancel = await tryAsUser(db, IDS.customer, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      customerReason,
    ]);
    expect(cancel.error).toBeUndefined();
    const release = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count FROM public.customer_wallet_entries
       WHERE idempotency_key = $1`,
      [`checkout_release:${paymobId}`],
    );
    expect(release[0]?.count).toBe("1");
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

    await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.ledger_insert_entry(
        $1, $2, 'adjustment', 'debit', 120, NULL, $3, $4, NULL)`,
      [IDS.provider, bookingId, `lesson_report_hold:${bookingId}`, IDS.adminUser],
    );

    const over = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_record_provider_payout($1, $2, 'TR-HOLD', 'payout')",
      [IDS.provider, 120],
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
});