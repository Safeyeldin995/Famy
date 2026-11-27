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
  setBookingStatusAsSystem,
  tryAsUser,
} from "./booking-lifecycle.harness";

/**
 * Admin audit fixes: #550 (card refund vs wallet refund), #551 (problem cards
 * open the list they count), #552 (attendance check failures), #553 (Arabic
 * digits in the admin search).
 */
let db: PGlite;
let nextOrder = 881000;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function paidCardBooking(status: "cancelled" | "completed") {
  const { bookingId } = await seedLifecycleBooking(db);
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  const orderId = nextOrder++;
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = now(), payment_method_type = 'online',
          payment_method_code = 'paymob', method = 'paymob', paymob_order_id = ${orderId},
          currency = 'EGP'
      WHERE id = '${paymobId}';
    `),
  );
  await setBookingStatusAsSystem(db, bookingId, status);
  return { bookingId, paymobId, orderId };
}

async function funded(paymentId: string): Promise<number> {
  const rows = await queryRows<{ f: string }>(
    db,
    `SELECT public.payment_checkout_funded_total(p)::text AS f FROM public.payments p WHERE p.id = $1`,
    [paymentId],
  );
  return Number(rows[0].f);
}

async function cardAmount(paymentId: string): Promise<number> {
  const rows = await queryRows<{ a: string }>(
    db,
    `SELECT amount::text AS a FROM public.payments WHERE id = $1`,
    [paymentId],
  );
  return Number(rows[0].a);
}

const cardRefund = (orderId: number, cents: number, tx = nextOrder++ * 10) =>
  asServiceRole(db, () =>
    queryRows(
      db,
      "SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, $3::bigint, false, '{}'::jsonb)",
      [tx, orderId, cents],
    ),
  );

async function quote(bookingId: string) {
  const res = await tryAsUser(
    db,
    IDS.adminUser,
    `SELECT public.admin_booking_wallet_refund_quote($1) AS q`,
    [bookingId],
  );
  expect(res.error).toBeUndefined();
  return (res.rows?.[0] as { q: Record<string, unknown> }).q;
}

const walletRefund = (bookingId: string, amount: number) =>
  tryAsUser(
    db,
    IDS.adminUser,
    `SELECT public.admin_refund_booking_to_wallet($1, $2, 'العميل اشتكى', $3) AS r`,
    [bookingId, amount, randomUUID()],
  );

describe("#550 a card refund comes off the wallet refund", () => {
  it("completed lesson: a full card refund leaves nothing for the wallet", async () => {
    const { bookingId, paymobId, orderId } = await paidCardBooking("completed");
    const card = await cardAmount(paymobId);
    await cardRefund(orderId, Math.round(card * 100));

    const q = await quote(bookingId);
    expect(Number(q.card_refunded)).toBeCloseTo(card, 2);
    expect(Number(q.max_refundable)).toBeCloseTo(Math.max((await funded(paymobId)) - card, 0), 2);
    if (Number(q.max_refundable) === 0) expect(q.blocked).toBe("refunded_to_card");
    const res = await walletRefund(bookingId, card);
    expect(res.ok).toBe(false);
  });

  it("completed lesson: a partial card refund lowers the maximum, parts never pass it", async () => {
    const { bookingId, paymobId, orderId } = await paidCardBooking("completed");
    const total = await funded(paymobId);
    await cardRefund(orderId, 5000);

    const q = await quote(bookingId);
    expect(q.blocked).toBeNull();
    expect(Number(q.max_refundable)).toBeCloseTo(total - 50, 2);

    const over = await walletRefund(bookingId, total - 50 + 1);
    expect(over.error).toMatch(/WALLET_REFUND_TOO_HIGH/);
    expect((await walletRefund(bookingId, 10)).error).toBeUndefined();
    expect(Number((await quote(bookingId)).max_refundable)).toBeCloseTo(total - 60, 2);
    expect((await walletRefund(bookingId, total - 60)).error).toBeUndefined();
    const done = await quote(bookingId);
    expect(done.blocked).toBe("refunded_to_card");
    expect((await walletRefund(bookingId, 1)).ok).toBe(false);

    // A second card refund after the wallet refunds still cannot open more room.
    await cardRefund(orderId, 1000);
    expect(Number((await quote(bookingId)).max_refundable)).toBe(0);
  });

  it("cancelled booking: the card refund comes off what is held", async () => {
    const { bookingId, paymobId, orderId } = await paidCardBooking("cancelled");
    const before = await quote(bookingId);
    expect(before.blocked).toBeNull();
    const heldBefore = Number(before.max_refundable);

    await cardRefund(orderId, 3000);
    const after = await quote(bookingId);
    expect(Number(after.max_refundable)).toBeCloseTo(Math.max(heldBefore - 30, 0), 2);

    await cardRefund(orderId, Math.round((await funded(paymobId)) * 100));
    const full = await quote(bookingId);
    expect(Number(full.max_refundable)).toBe(0);
    expect(full.blocked).toBe("refunded_to_card");
    expect((await walletRefund(bookingId, 1)).ok).toBe(false);
  });

  it("a refund with no amount blocks the wallet refund", async () => {
    const { bookingId, orderId } = await paidCardBooking("completed");
    await asServiceRole(db, () =>
      queryRows(
        db,
        "SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, NULL, false, '{}'::jsonb, 'cumulative', NULL)",
        [nextOrder++ * 10, orderId],
      ),
    );
    const q = await quote(bookingId);
    expect(q.blocked).toBe("card_refund_unknown");
    expect((await walletRefund(bookingId, 1)).ok).toBe(false);
  });

  it("shows the card refund on the money card", async () => {
    const { bookingId, orderId } = await paidCardBooking("completed");
    await cardRefund(orderId, 2500);
    const res = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_booking_money_summary($1) AS s`,
      [bookingId],
    );
    expect(res.error).toBeUndefined();
    const s = (res.rows?.[0] as { s: { payments: { gateway_refunded: number }[] } }).s;
    expect(s.payments.some((p) => Number(p.gateway_refunded) === 25)).toBe(true);
  });

  it("keeps the new helpers away from signed-in and anonymous users", async () => {
    for (const sig of [
      "public.payment_gateway_refunded_total(public.payments)",
      "public.payment_gateway_refund_unknown(public.payments)",
    ]) {
      const rows = await queryRows<{ a: boolean; u: boolean }>(
        db,
        `SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS a,
                has_function_privilege('anon', '${sig}', 'EXECUTE') AS u`,
      );
      expect(rows[0]).toEqual({ a: false, u: false });
    }
  });
});

async function problems(): Promise<Record<string, number>> {
  const res = await tryAsUser(db, IDS.adminUser, `SELECT public.admin_ops_problems() AS x`);
  expect(res.error).toBeUndefined();
  const x = (res.rows?.[0] as { x: Record<string, unknown> }).x;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Number(v)]));
}

async function problemIds(kind: string): Promise<string[]> {
  const res = await tryAsUser(
    db,
    IDS.adminUser,
    `SELECT public.admin_ops_problem_booking_ids($1) AS ids`,
    [kind],
  );
  expect(res.error).toBeUndefined();
  return (res.rows?.[0] as { ids: string[] }).ids;
}

async function moveBooking(bookingId: string, set: string) {
  await asServiceRole(db, () =>
    db.exec(`UPDATE public.bookings SET ${set} WHERE id = '${bookingId}'`),
  );
}

describe("#551 / #552 problem cards count the list they open", () => {
  it("each booking card equals its list, and only admins can read the list", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await moveBooking(
      bookingId,
      "start_at = now() - interval '2 hours', end_at = now() - interval '1 hour'",
    );
    const p = await problems();
    for (const kind of ["stuck_pending", "stuck_active", "attendance_failed"]) {
      expect((await problemIds(kind)).length).toBe(p[kind]);
    }
    expect(await problemIds("stuck_pending")).toContain(bookingId);

    const denied = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.admin_ops_problem_booking_ids('stuck_pending')`,
    );
    expect(denied.ok).toBe(false);
    const bad = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_ops_problem_booking_ids('x')`,
    );
    expect(bad.error).toMatch(/Invalid problem kind/);
  });

  it("the Paymob card equals the payments 'paymob' tab", async () => {
    const { paymobId } = await paidCardBooking("completed");
    await asServiceRole(db, () =>
      db.exec(`
        SELECT set_config('app.ledger_internal_capture', 'on', true);
        UPDATE public.payments
        SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"capture_shortfall": 40}'::jsonb
        WHERE id = '${paymobId}';
      `),
    );
    const tab = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue('paymob', '', 100, 0) AS q`,
    );
    expect(tab.error).toBeUndefined();
    const q = (tab.rows?.[0] as { q: { total: number; items: { id: string }[] } }).q;
    expect(q.items.map((i) => i.id)).toContain(paymobId);
    expect((await problems()).paymob_flags).toBe(Number(q.total));

    const counts = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue_counts() AS c`,
    );
    expect(Number((counts.rows?.[0] as { c: { paymob: number } }).c.paymob)).toBe(Number(q.total));
  });

  it("flags an online lesson whose attendance check fails, and clears it when it works", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await db.exec(`
      ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
      UPDATE public.bookings
      SET service_mode = 'online', start_at = now() - interval '20 minutes',
          end_at = now() + interval '40 minutes'
      WHERE id = '${bookingId}';
      ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
    `);
    const addPoll = (ok: boolean, ago: string) =>
      asServiceRole(db, () =>
        db.exec(`
          INSERT INTO public.session_presence_polls (booking_id, polled_at, ok)
          VALUES ('${bookingId}', now() - interval '${ago}', ${ok});
        `),
      );

    expect(await problemIds("attendance_failed")).not.toContain(bookingId);
    await addPoll(false, "2 minutes");
    expect(await problemIds("attendance_failed")).toContain(bookingId);
    expect((await problems()).attendance_failed).toBe(
      (await problemIds("attendance_failed")).length,
    );
    await addPoll(true, "1 minute");
    expect(await problemIds("attendance_failed")).not.toContain(bookingId);

    // Ended with almost no successful checks: not enough evidence to settle it.
    await moveBooking(
      bookingId,
      "start_at = now() - interval '2 hours', end_at = now() - interval '1 hour'",
    );
    expect(await problemIds("attendance_failed")).toContain(bookingId);
  });
});

describe("#553 admin search reads Arabic digits", () => {
  it("finds the same customer from 01, +20, 0020 and Arabic-digit forms", async () => {
    await seedLifecycleBooking(db);
    const local = `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    await asServiceRole(db, () =>
      db.query(`UPDATE public.profiles SET phone = $1 WHERE id = $2`, [
        `+20${local.slice(1)}`,
        IDS.customer,
      ]),
    );
    const arabic = local.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
    const persian = local.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    for (const q of [local, `+20${local.slice(1)}`, `0020${local.slice(1)}`, arabic, persian]) {
      const res = await tryAsUser(db, IDS.adminUser, `SELECT public.admin_global_search($1) AS r`, [
        q,
      ]);
      expect(res.error).toBeUndefined();
      const r = (res.rows?.[0] as { r: { customers: { items: { id: string }[] } } }).r;
      expect(r.customers.items.map((c) => c.id)).toContain(IDS.customer);
    }
  });
});
