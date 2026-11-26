import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

/**
 * #539 follow-ups from #537:
 * 1) fees carried from earlier bookings come back to the customer when the
 *    money for them was refunded (online tutor or both absent, provider cancel);
 * 2) Paymob refunds count each refund transaction once, by its own amount.
 */
let db: PGlite;
let providerReason: string;
const CARRIED = 30;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  const provider = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency'",
  );
  providerReason = provider[0]!.id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function waiveOpenFees() {
  await db.query(
    "UPDATE public.customer_debts SET status = 'waived', carried_booking_id = NULL WHERE customer_id = $1 AND status = 'open'",
    [IDS.customer],
  );
}

async function seedOpenFee(): Promise<string> {
  await waiveOpenFees();
  const { bookingId: oldBookingId } = await seedLifecycleBooking(db, { status: "cancelled" });
  const debtId = randomUUID();
  await db.query(
    `INSERT INTO public.customer_debts (id, customer_id, booking_id, provider_id, kind, amount)
     VALUES ($1, $2, $3, $4, 'late_cancellation', $5)`,
    [debtId, IDS.customer, oldBookingId, IDS.provider, CARRIED],
  );
  return debtId;
}

async function debt(debtId: string) {
  const rows = await queryRows<{ status: string; carried: string | null; carryable: boolean }>(
    db,
    `SELECT d.status::text AS status, d.carried_booking_id::text AS carried,
            d.id = ANY(public.customer_carryable_debt_ids(d.customer_id)) AS carryable
     FROM public.customer_debts d WHERE d.id = $1`,
    [debtId],
  );
  return rows[0]!;
}

async function carriedOn(bookingId: string): Promise<number> {
  const rows = await queryRows<{ c: string }>(
    db,
    "SELECT carried_fees_amount::text AS c FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  return Number(rows[0]!.c);
}

async function captureAsSystem(paymentId: string) {
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymentId}';
    `),
  );
}

async function walletCredit(bookingId: string, reason: string): Promise<{ count: number; sum: number }> {
  const rows = await queryRows<{ n: string; s: string }>(
    db,
    `SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::text AS s
     FROM public.customer_wallet_entries WHERE booking_id = $1 AND reason = $2`,
    [bookingId, reason],
  );
  return { count: Number(rows[0]!.n), sum: Number(rows[0]!.s) };
}

async function makeOnlinePastEnd(bookingId: string) {
  await db.exec(`
    ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
    UPDATE public.bookings
    SET service_mode = 'online',
        start_at = timestamptz '2026-11-25T16:30:00+00',
        end_at = timestamptz '2026-11-25T17:30:00+00',
        online_session_outcome = NULL,
        price_total = 200,
        price_provider_net = 160
    WHERE id = '${bookingId}';
    ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
  `);
}

async function seedPaymob(bookingId: string, orderId?: number): Promise<string> {
  await db.query("UPDATE public.payment_methods SET is_active = true WHERE code = 'paymob'");
  const method = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.payment_methods WHERE code = 'paymob' LIMIT 1",
  );
  const id = randomUUID();
  await asServiceRole(db, () =>
    db.query(
      `INSERT INTO public.payments (
         id, booking_id, customer_id, amount, status, payment_method_id,
         payment_method_type, payment_method_code, method, currency, metadata, paymob_order_id
       )
       SELECT $1, b.id, b.customer_id, b.price_total + COALESCE(b.carried_fees_amount, 0), 'pending',
              $3, 'online', 'paymob', 'paymob', 'EGP', '{}'::jsonb, $4
       FROM public.bookings b WHERE b.id = $2`,
      [id, bookingId, method[0]!.id, orderId ?? null],
    ),
  );
  return id;
}

describe("#539 carried fees come back when their money was refunded", () => {
  it("online tutor absent: full refund to the wallet and the carried fee is open again", async () => {
    const debtId = await seedOpenFee();
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    expect(await carriedOn(bookingId)).toBe(CARRIED);
    expect((await debt(debtId)).carried).toBe(bookingId);

    await makeOnlinePastEnd(bookingId);
    const paymobId = await seedPaymob(bookingId);
    await captureAsSystem(paymobId);
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.session_events (booking_id, participant, joined_at, left_at)
         SELECT id, 'customer', start_at, end_at FROM public.bookings WHERE id = $1`,
        [bookingId],
      ),
    );

    await asServiceRole(db, () =>
      queryRows(db, "SELECT public.settle_online_session_absence($1, 'provider_absent')", [bookingId]),
    );

    const refund = await walletCredit(bookingId, "online_no_show_refund");
    expect(refund.count).toBe(1);
    expect(refund.sum).toBeCloseTo(200 + CARRIED, 2);
    const d = await debt(debtId);
    expect(d.status).toBe("open");
    expect(d.carried).toBeNull();
    expect(d.carryable).toBe(true);
  });

  it("provider cancel: the refund includes the carried fee and the fee is open again", async () => {
    const debtId = await seedOpenFee();
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    expect(await carriedOn(bookingId)).toBe(CARRIED);
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET payment_method_type = 'online', payment_method_code = 'paymob', method = 'paymob', currency = 'EGP'
         WHERE id = $1`,
        [paymobId],
      ),
    );
    await captureAsSystem(paymobId);
    const due = await queryRows<{ a: string }>(db, "SELECT amount::text AS a FROM public.payments WHERE id = $1", [
      paymobId,
    ]);

    const r = await tryAsUser(db, IDS.providerUser, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      providerReason,
    ]);
    expect(r.error).toBeUndefined();

    const credit = await walletCredit(bookingId, "provider_cancelled");
    expect(credit.count).toBe(1);
    expect(credit.sum).toBeCloseTo(Number(due[0]!.a), 2);
    const d = await debt(debtId);
    expect(d.status).toBe("open");
    expect(d.carried).toBeNull();
    expect(d.carryable).toBe(true);
  });

  it("the next booking picks the released fee up exactly once", async () => {
    const before = await queryRows<{ n: string }>(
      db,
      `SELECT COALESCE(sum(amount), 0)::text AS n FROM public.customer_debts
       WHERE customer_id = $1 AND status = 'open' AND carried_booking_id IS NULL`,
      [IDS.customer],
    );
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    expect(await carriedOn(bookingId)).toBeCloseTo(Number(before[0]!.n), 2);
  });

  it("release_unheld_carried_fees is internal", async () => {
    const r = await tryAsUser(db, IDS.customer, "SELECT public.release_unheld_carried_fees($1)", [randomUUID()]);
    expect(r.error).toBeDefined();
  });
});

describe("#539 Paymob refunds count each refund transaction once", () => {
  async function paidOrder(orderId: number) {
    await waiveOpenFees();
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const paymobId = await seedPaymob(bookingId, orderId);
    await captureAsSystem(paymobId);
    return paymobId;
  }

  const refund = (tx: number, order: number, cents: number, kind: string | null, cumulative: number | null = null) =>
    asServiceRole(db, () =>
      queryRows<{ r: Record<string, unknown> }>(
        db,
        `SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, $3::bigint, false, '{}'::jsonb, $4::text, $5::bigint) AS r`,
        [tx, order, cents, kind, cumulative],
      ),
    );

  async function total(paymentId: string) {
    const rows = await queryRows<{ t: string; unknown: string | null }>(
      db,
      `SELECT metadata->>'gateway_refund_amount_cents' AS t,
              metadata->>'gateway_refund_amount_unknown' AS unknown
       FROM public.payments WHERE id = $1`,
      [paymentId],
    );
    return { total: Number(rows[0]!.t), unknown: rows[0]!.unknown };
  }

  it("two partial refund transactions add up and a replay is ignored", async () => {
    const paymentId = await paidOrder(881001);
    await refund(881501, 881001, 5000, "transaction");
    await refund(881502, 881001, 3000, "transaction");
    const replay = await refund(881501, 881001, 5000, "transaction");
    expect(replay[0]?.r?.duplicate).toBe(true);
    expect((await total(paymentId)).total).toBe(8000);
  });

  it("a cumulative callback on the original transaction never double counts", async () => {
    const paymentId = await paidOrder(881002);
    await refund(882501, 881002, 5000, "transaction");
    await refund(882502, 881002, 3000, "transaction");
    // The original transaction reports the same 8000 refunded so far: no change.
    const same = await refund(882000, 881002, 20000, "cumulative", 8000);
    expect((await total(paymentId)).total).toBe(8000);
    expect(same[0]?.r?.ok).toBe(true);
    // A later cumulative total raises it.
    await refund(882000, 881002, 20000, "cumulative", 9000);
    expect((await total(paymentId)).total).toBe(9000);
    const again = await refund(882000, 881002, 20000, "cumulative", 9000);
    expect(again[0]?.r?.duplicate).toBe(true);
  });

  it("a refunded original transaction with no amount still flags the payment", async () => {
    const paymentId = await paidOrder(881003);
    const r = await refund(883000, 881003, 20000, "cumulative", null);
    expect(r[0]?.r?.ok).toBe(true);
    const t = await total(paymentId);
    expect(t.unknown).toBe("true");
    const flag = await queryRows<{ review: string }>(
      db,
      "SELECT metadata->>'needs_admin_review' AS review FROM public.payments WHERE id = $1",
      [paymentId],
    );
    expect(flag[0]?.review).toBe("true");
  });
});
