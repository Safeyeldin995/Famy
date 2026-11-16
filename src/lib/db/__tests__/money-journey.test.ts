/**
 * End-to-end money journey across every payment path, on a full migration replay:
 * card and cash completions, early/late cancellations, customer and provider no-shows,
 * fee debts settled by InstaPay, refunds, the provider wallet balance and a payout.
 * Each step checks the money left where it should; the final balance must equal the
 * sum of what each scenario should have produced.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  completeHappyPath,
  createBookingLifecycleDb,
  IDS,
  paymentStatus,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  setBookingStatusAsSystem,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;
let customerReason: string;
let expectedNet = 0;

const FEE = 50;

/** Fixed, realistic pricing so every scenario has a known total and provider share. */
async function newBooking(status?: "confirmed") {
  const { bookingId } = await seedLifecycleBooking(db, status ? { status } : undefined);
  await asServiceRole(db, () =>
    db.query(
      `UPDATE public.bookings
       SET price_total = 500, price_provider_net = 400,
           price_commission_percent = 20, price_commission_amount = 100
       WHERE id = $1`,
      [bookingId],
    ),
  );
  return { bookingId };
}

async function bookingMoney(bookingId: string) {
  const rows = await queryRows<{ total: string; net: string }>(
    db,
    "SELECT price_total::text AS total, price_provider_net::text AS net FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  return { total: Number(rows[0].total), net: Number(rows[0].net) };
}

async function providerNet() {
  const rows = await queryRows<{ net: string }>(
    db,
    "SELECT net::text AS net FROM public.provider_balance($1)",
    [IDS.provider],
  );
  return Number(rows[0].net);
}

async function capture(paymentId: string) {
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymentId}';
    `),
  );
}

/** Keep only the chosen payment for the booking (the harness seeds cash + card together). */
async function keepOnly(bookingId: string, keepId: string) {
  await asServiceRole(db, () =>
    db.query("DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2", [bookingId, keepId]),
  );
}

const cancel = (bookingId: string) =>
  tryAsUser(db, IDS.customer, "SELECT public.cancel_booking($1, $2, NULL)", [
    bookingId,
    customerReason,
  ]);

const refund = (paymentId: string, ref: string) =>
  tryAsUser(db, IDS.adminUser, "SELECT public.admin_record_payment_refund($1, $2)", [
    paymentId,
    ref,
  ]);

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
  const reasons = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.cancellation_reasons WHERE code = 'customer_change_of_plans'",
  );
  customerReason = reasons[0].id;
  await asServiceRole(db, () =>
    db.exec(`
      UPDATE public.settings SET value = '{"fee_mode":"fixed","fee_value":${FEE},"free_cancel_hours":2}'::jsonb
      WHERE key = 'cancellation_policy';
      UPDATE public.settings
      SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object('ledger_auto_from', (now() - interval '1 day'))
      WHERE key = 'provider_settlement';
    `),
  );
  expect(await providerNet()).toBe(0);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("money journey", () => {
  it("A. card booking completed: the provider is owed their share", async () => {
    const { bookingId } = await newBooking();
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, paymobId);
    await capture(paymobId);
    await completeHappyPath(db, bookingId);
    const m = await bookingMoney(bookingId);
    expectedNet += m.net;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("B. cash booking completed: the provider owes Famy's commission", async () => {
    const { bookingId } = await newBooking();
    const { cashId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, cashId);
    await completeHappyPath(db, bookingId);
    const m = await bookingMoney(bookingId);
    expectedNet -= m.total - m.net;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
    expect(await paymentStatus(db, cashId)).toBe("captured");
  });

  it("C. card paid, cancelled well ahead: full refund, no fee", async () => {
    const { bookingId } = await newBooking("confirmed");
    await asServiceRole(db, () =>
      db.query(
        "UPDATE public.bookings SET start_at = now() + interval '3 days', end_at = now() + interval '3 days 2 hours' WHERE id = $1",
        [bookingId],
      ),
    );
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, paymobId);
    await capture(paymobId);
    expect((await cancel(bookingId)).error).toBeUndefined();
    expect((await refund(paymobId, "PM-C")).error).toBeUndefined();
    expect(await paymentStatus(db, paymobId)).toBe("refunded");
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("D. card paid, cancelled after the provider set off: refund minus the fee, fee to the provider", async () => {
    const { bookingId } = await newBooking("confirmed");
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, paymobId);
    await capture(paymobId);
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    expect((await cancel(bookingId)).error).toBeUndefined();
    expect((await refund(paymobId, "PM-D")).error).toBeUndefined();
    const m = await bookingMoney(bookingId);
    const meta = await queryRows<{ back: string }>(
      db,
      "SELECT metadata->'refund'->>'amount_refunded' AS back FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(Number(meta[0].back)).toBeCloseTo(m.total - FEE, 2);
    expect(await paymentStatus(db, paymobId)).toBe("partially_refunded");
    expectedNet += FEE;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("E. cash, cancelled after the provider set off: debt, blocked, paid by InstaPay, fee to the provider", async () => {
    const { bookingId } = await newBooking("confirmed");
    const { cashId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, cashId);
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    expect((await cancel(bookingId)).error).toBeUndefined();
    // Nothing moves on the wallet until the customer pays.
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
    await expect(seedLifecycleBooking(db)).rejects.toThrow(/BOOKING_DEBT_OUTSTANDING/);
    const del = await tryAsUser(db, IDS.customer, "SELECT public.account_deletion_check() AS c");
    expect((del.rows![0].c as { reason: string }).reason).toBe("unpaid_balance");

    const sub = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_submit_debt_instapay('IP-E1') AS id",
    );
    const sid = String(sub.rows![0].id);
    expect(
      (
        await tryAsUser(db, IDS.adminUser, "SELECT public.admin_review_debt_settlement($1, true)", [
          sid,
        ])
      ).error,
    ).toBeUndefined();
    expectedNet += FEE;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
    const { bookingId: again } = await seedLifecycleBooking(db);
    expect(again).toBeTruthy();
  });

  it("F. provider didn't show up on a paid booking: full refund, no fee", async () => {
    const { bookingId } = await newBooking("confirmed");
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, paymobId);
    await capture(paymobId);
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    const report = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.report_no_show($1, 'Provider never came', '{}')",
      [bookingId],
    );
    expect(report.error).toBeUndefined();
    expect((await refund(paymobId, "PM-F")).error).toBeUndefined();
    expect(await paymentStatus(db, paymobId)).toBe("refunded");
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("G. the admin pays the provider exactly what Famy owes, never more", async () => {
    const net = await providerNet();
    expect(net).toBeCloseTo(expectedNet, 2);
    if (net > 0) {
      const over = await tryAsUser(
        db,
        IDS.adminUser,
        "SELECT public.admin_record_provider_payout($1, $2, 'TR-X', 'payout')",
        [IDS.provider, net + 1],
      );
      expect(over.ok).toBe(false);
      const exact = await tryAsUser(
        db,
        IDS.adminUser,
        "SELECT public.admin_record_provider_payout($1, $2, 'TR-1', 'payout')",
        [IDS.provider, net],
      );
      expect(exact.error).toBeUndefined();
    } else {
      const exact = await tryAsUser(
        db,
        IDS.adminUser,
        "SELECT public.admin_record_provider_debt_payment($1, $2, 'IP-PRO', 'commission')",
        [IDS.provider, -net],
      );
      expect(exact.error).toBeUndefined();
    }
    expect(await providerNet()).toBeCloseTo(0, 2);
  });
});
