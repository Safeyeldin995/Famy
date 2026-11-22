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

/** A receipt file the customer uploaded (storage is a stub in the migration replay). */
const putReceipt = (path: string) =>
  db.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('payment-proofs', $1)", [path]);
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
  await putReceipt(`fees/${IDS.customer}/e1.jpg`);
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

  it("E. cash, cancelled after the provider set off: debt, paid by InstaPay receipt, fee to the provider", async () => {
    const { bookingId } = await newBooking("confirmed");
    const { cashId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, cashId);
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    expect((await cancel(bookingId)).error).toBeUndefined();
    // Nothing moves on the wallet until the customer pays.
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
    const del = await tryAsUser(db, IDS.customer, "SELECT public.account_deletion_check() AS c");
    expect((del.rows![0].c as { reason: string }).reason).toBe("unpaid_balance");

    const sub = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/e1.jpg') AS id`,
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
    // Nothing left to add to the next booking.
    const left = await tryAsUser(db, IDS.customer, "SELECT * FROM public.my_unpaid_fees()");
    expect(left.rows).toEqual([]);
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

  /** Cash booking cancelled after the provider set off: leaves an unpaid fee. */
  async function lateCashCancel() {
    const { bookingId } = await newBooking("confirmed");
    const { cashId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, cashId);
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    expect((await cancel(bookingId)).error).toBeUndefined();
    return bookingId;
  }

  async function carried(bookingId: string) {
    const rows = await queryRows<{ c: string; due: string }>(
      db,
      "SELECT carried_fees_amount::text AS c, (price_total + carried_fees_amount)::text AS due FROM public.bookings WHERE id = $1",
      [bookingId],
    );
    return { carried: Number(rows[0].c), due: Number(rows[0].due) };
  }

  it("H. unpaid fee rides on the next cash booking: provider collects it, wallet debited, fee credited", async () => {
    const owed = await lateCashCancel();
    const { bookingId } = await newBooking();
    expect(await carried(bookingId)).toEqual({ carried: FEE, due: 500 + FEE });
    const { cashId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, cashId);
    await completeHappyPath(db, bookingId);
    const ledger = await queryRows<{ kind: string; amount: string }>(
      db,
      "SELECT kind, amount::text AS amount FROM public.provider_ledger_entries WHERE booking_id IN ($1, $2) ORDER BY kind",
      [owed, bookingId],
    );
    expect(ledger).toEqual([
      { kind: "cancellation_fee_provider_share", amount: "50.00" },
      { kind: "carried_fee_collected", amount: "50.00" },
      { kind: "cash_collected_platform_share", amount: "100.00" },
    ]);
    // Collected the fee (-50), earned the fee (+50), owes the commission (-100).
    expectedNet -= 100;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
    const left = await tryAsUser(db, IDS.customer, "SELECT * FROM public.my_unpaid_fees()");
    expect(left.rows).toEqual([]);
  });

  it("I. unpaid fee rides on the next card booking: paid with it, fee credited on completion", async () => {
    await lateCashCancel();
    const { bookingId } = await newBooking();
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await keepOnly(bookingId, paymobId);
    const pay = await queryRows<{ a: string }>(
      db,
      "SELECT amount::text AS a FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(Number(pay[0].a)).toBe(500 + FEE);
    await capture(paymobId);
    await completeHappyPath(db, bookingId);
    expectedNet += 400 + FEE;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("J. card booking carrying a fee, cancelled early: refund keeps only the carried fee", async () => {
    await lateCashCancel();
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
    const preview = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_payment_refund_breakdown($1) AS b",
      [paymobId],
    );
    expect(preview.rows![0].b).toEqual({ paid: 550, fee: 0, carried: FEE, refund: 500 });
    expect((await refund(paymobId, "PM-J")).error).toBeUndefined();
    const meta = await queryRows<{ back: string; kept: string }>(
      db,
      "SELECT metadata->'refund'->>'amount_refunded' AS back, metadata->'refund'->>'carried_fees' AS kept FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(Number(meta[0].back)).toBeCloseTo(500, 2);
    expect(Number(meta[0].kept)).toBeCloseTo(FEE, 2);
    expect(await paymentStatus(db, paymobId)).toBe("partially_refunded");
    expectedNet += FEE;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("L. a late refund on the cancelled booking does not keep fees on the next booking", async () => {
    const owed = await lateCashCancel();
    const { bookingId } = await newBooking();
    expect(await carried(bookingId)).toEqual({ carried: FEE, due: 500 + FEE });
    const { paymobId } = await seedPaymentsForBooking(db, owed);
    await keepOnly(owed, paymobId);
    await capture(paymobId);
    expect((await refund(paymobId, "PM-L")).error).toBeUndefined();
    expect(await carried(bookingId)).toEqual({ carried: 0, due: 500 });
    const debt = await queryRows<{ status: string; carried: string | null }>(
      db,
      "SELECT status, carried_booking_id::text AS carried FROM public.customer_debts WHERE booking_id = $1",
      [owed],
    );
    expect(debt[0].status).toBe("paid");
    expect(debt[0].carried).toBeNull();
    const methods = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.payment_methods WHERE code = 'paymob'",
    );
    await expect(
      asServiceRole(db, () =>
        db.query(
          `INSERT INTO public.payments (booking_id, customer_id, amount, status, payment_method_id, metadata)
           VALUES ($1, $2, 500, 'pending', $3, '{}'::jsonb)`,
          [bookingId, IDS.customer, methods[0].id],
        ),
      ),
    ).resolves.toBeDefined();
    expectedNet += FEE;
    expect(await providerNet()).toBeCloseTo(expectedNet, 2);
  });

  it("M. rejecting a no-show after the fee rode forward clears it from the next booking", async () => {
    const { bookingId: owed } = await newBooking("confirmed");
    await setBookingStatusAsSystem(db, owed, "on_the_way");
    const report = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.report_no_show($1, 'Customer absent', '{}')",
      [owed],
    );
    expect(report.error).toBeUndefined();
    const reportId = String(Object.values(report.rows![0])[0]);
    const { bookingId: next } = await newBooking();
    expect(await carried(next)).toEqual({ carried: FEE, due: 500 + FEE });
    const resolve = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_resolve_no_show($1, 'rejected', 'Customer was there', 'completed')",
      [reportId],
    );
    expect(resolve.error).toBeUndefined();
    expect(await carried(next)).toEqual({ carried: 0, due: 500 });
    const left = await tryAsUser(db, IDS.customer, "SELECT * FROM public.my_unpaid_fees()");
    expect(left.rows).toEqual([]);
  });

  it("K. a booking must be paid in full, carried fees included; the fee can't be waived mid-booking", async () => {
    await lateCashCancel();
    const { bookingId } = await newBooking();
    const methods = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.payment_methods WHERE code = 'paymob'",
    );
    await expect(
      asServiceRole(db, () =>
        db.query(
          `INSERT INTO public.payments (booking_id, customer_id, amount, status, payment_method_id, metadata)
           VALUES ($1, $2, 500, 'pending', $3, '{}'::jsonb)`,
          [bookingId, IDS.customer, methods[0].id],
        ),
      ),
    ).rejects.toThrow(/must match the booking total/);
    const debt = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.customer_debts WHERE carried_booking_id = $1",
      [bookingId],
    );
    const waive = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_waive_customer_debt($1, 'test')",
      [debt[0].id],
    );
    expect(waive.error).toMatch(/active booking/);
    // Customer cancels before anything is paid: the fee is free again, then waived.
    await setBookingStatusAsSystem(db, bookingId, "cancelled");
    expect(
      (
        await tryAsUser(db, IDS.adminUser, "SELECT public.admin_waive_customer_debt($1, 'test')", [
          debt[0].id,
        ])
      ).error,
    ).toBeUndefined();
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
