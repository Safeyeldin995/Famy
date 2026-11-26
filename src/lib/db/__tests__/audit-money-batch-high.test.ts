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

let db: PGlite;

async function seedOnlineBookingPastEnd(): Promise<string> {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  await db.exec(`
    ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
    UPDATE public.bookings
    SET service_mode = 'online',
        start_at = timestamptz '2026-11-25T16:30:00+00',
        end_at = timestamptz '2026-11-25T17:30:00+00',
        online_session_outcome = NULL
    WHERE id = '${bookingId}';
    ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
  `);
  return bookingId;
}

const PAYMOB_INTEGRATION_ID = 456;

async function seedOnlineBookingEnding(endAtIso: string): Promise<string> {
  const bookingId = await seedOnlineBookingPastEnd();
  await db.exec(`
    UPDATE public.bookings
    SET start_at = timestamptz '${endAtIso}' - interval '1 hour',
        end_at = timestamptz '${endAtIso}',
        online_session_outcome = NULL
    WHERE id = '${bookingId}';
  `);
  return bookingId;
}

async function addFullAttendance(bookingId: string) {
  const times = await queryRows<{ start_at: string; end_at: string }>(
    db,
    "SELECT start_at::text, end_at::text FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  const startAt = times[0]?.start_at;
  const endAt = times[0]?.end_at;
  if (!startAt || !endAt) throw new Error("expected booking times");
  await asServiceRole(db, () =>
    db.query(
      `INSERT INTO public.session_events (booking_id, participant, joined_at, left_at) VALUES
        ($1, 'customer', $2::timestamptz, $3::timestamptz),
        ($1, 'provider', $2::timestamptz, $3::timestamptz)`,
      [bookingId, startAt, endAt],
    ),
  );
}

async function applyPaymobWebhook(
  orderId: number,
  transactionId: number,
  amountCents: number,
  success: boolean,
  pending: boolean,
) {
  return asServiceRole(db, () =>
    queryRows<{ payload: Record<string, unknown> }>(
      db,
      `SELECT public.paymob_apply_transaction_webhook(
         $1::bigint, $2::bigint, $3::bigint, 'EGP', $4, $5, $6::bigint, 'provider-ref', '{}'::jsonb
       ) AS payload`,
      [transactionId, orderId, PAYMOB_INTEGRATION_ID, success, pending, amountCents],
    ),
  );
}

async function bindPaymobPayment(paymentId: string, orderId: number, amount: string) {
  await asServiceRole(db, () =>
    db.query(
      `UPDATE public.payments
       SET payment_method_type = 'online',
           payment_method_code = 'paymob',
           method = 'paymob',
           paymob_order_id = $2,
           paymob_integration_id = $3,
           currency = 'EGP',
           amount = $4::numeric
       WHERE id = $1::uuid`,
      [paymentId, orderId, PAYMOB_INTEGRATION_ID, amount],
    ),
  );
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("audit money batch — #439 online session auto-complete", () => {
  it("marks attended lessons complete after grace window", async () => {
    const bookingId = await seedOnlineBookingPastEnd();
    await addFullAttendance(bookingId);

    const resolved = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
    );
    expect(resolved[0]?.n).toBe(1);

    const row = await queryRows<{ status: string; outcome: string | null }>(
      db,
      "SELECT status::text AS status, online_session_outcome AS outcome FROM public.bookings WHERE id = $1",
      [bookingId],
    );
    expect(row[0]?.outcome).toBe("complete");
    expect(row[0]?.status).toBe("completed");
  });

  it("leaves confirmed status when attendance evidence is absent", async () => {
    const bookingId = await seedOnlineBookingPastEnd();

    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
    );

    const row = await queryRows<{ status: string; outcome: string | null }>(
      db,
      "SELECT status::text AS status, online_session_outcome AS outcome FROM public.bookings WHERE id = $1",
      [bookingId],
    );
    expect(row[0]?.outcome).toBe("admin_review_no_events");
    expect(row[0]?.status).toBe("confirmed");
  });

  it("completes an older unresolved lesson (no rollout cutoff)", async () => {
    const bookingId = await seedOnlineBookingEnding("2025-11-20T12:00:00Z");
    await addFullAttendance(bookingId);

    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
    );

    const row = await queryRows<{ status: string; outcome: string | null }>(
      db,
      "SELECT status::text AS status, online_session_outcome AS outcome FROM public.bookings WHERE id = $1",
      [bookingId],
    );
    expect(row[0]?.outcome).toBe("complete");
    expect(row[0]?.status).toBe("completed");
  });

  it("never revisits a lesson that was already resolved", async () => {
    const bookingId = await seedOnlineBookingEnding("2025-11-20T12:00:00Z");
    await addFullAttendance(bookingId);
    await asServiceRole(db, () =>
      db.query(
        "UPDATE public.bookings SET online_session_outcome = 'admin_review_overlap' WHERE id = $1",
        [bookingId],
      ),
    );

    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
    );

    const row = await queryRows<{ status: string; outcome: string | null }>(
      db,
      "SELECT status::text AS status, online_session_outcome AS outcome FROM public.bookings WHERE id = $1",
      [bookingId],
    );
    expect(row[0]?.outcome).toBe("admin_review_overlap");
    expect(row[0]?.status).toBe("confirmed");
  });
});

describe("audit money batch — #440 superseded Paymob capture", () => {
  it("credits customer wallet when an older attempt captures after retry B funded the booking", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings SET price_total = 500, price_provider_net = 400 WHERE id = $1`,
        [bookingId],
      ),
    );
    const { paymobId: paymentA } = await seedPaymentsForBooking(db, bookingId);
    const due = await queryRows<{ due: string }>(
      db,
      `SELECT amount::text AS due FROM public.payments WHERE id = $1`,
      [paymentA],
    );
    const amount = due[0]?.due ?? "500";
    const amountCents = Math.round(Number(amount) * 100);
    const paymentB = randomUUID();
    const paymobMethod = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.payment_methods WHERE code = 'paymob' LIMIT 1`,
    );
    const methodId = paymobMethod[0]?.id;
    if (!methodId) throw new Error("expected paymob payment method");

    await bindPaymobPayment(paymentA, 880_001, amount);
    await applyPaymobWebhook(880_001, 880_101, amountCents, false, false);

    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status, payment_method_id,
           payment_method_type, payment_method_code, method, paymob_order_id, paymob_integration_id, currency
         ) VALUES (
           $1, $2, $3, $4::numeric, 'pending', $5, 'online', 'paymob', 'paymob', 880002, $6, 'EGP'
         )`,
        [paymentB, bookingId, IDS.customer, amount, methodId, PAYMOB_INTEGRATION_ID],
      ),
    );

    const captureB = await applyPaymobWebhook(880_002, 880_102, amountCents, true, false);
    expect(captureB[0]?.payload?.ok).toBe(true);

    const captureA = await applyPaymobWebhook(880_001, 880_103, amountCents, true, false);
    expect(captureA[0]?.payload?.superseded_capture).toBe(true);

    const wallet = await queryRows<{ count: string; amount: string }>(
      db,
      `SELECT count(*)::text AS count, sum(amount)::text AS amount
       FROM public.customer_wallet_entries
       WHERE idempotency_key = $1`,
      [`paymob_superseded_excess:${paymentA}`],
    );
    expect(wallet[0]?.count).toBe("1");
    expect(Number(wallet[0]?.amount)).toBeCloseTo(Number(amount), 2);

    const funded = await queryRows<{ count: string }>(
      db,
      `SELECT count(*)::text AS count
       FROM public.payments
       WHERE booking_id = $1 AND status = 'captured'
         AND COALESCE((metadata->>'excluded_from_booking_funding')::boolean, false) = false`,
      [bookingId],
    );
    expect(funded[0]?.count).toBe("1");

    // The superseded row is closed as refunded through the wallet, so nothing
    // that looks for "the booking's captured payment" can pick it again.
    const rowA = await queryRows<{ status: string; channel: string | null; settled: string | null }>(
      db,
      `SELECT status::text AS status,
              metadata->'refund'->>'channel' AS channel,
              metadata->>'wallet_refund_settled' AS settled
       FROM public.payments WHERE id = $1`,
      [paymentA],
    );
    expect(rowA[0]?.status).toBe("refunded");
    expect(rowA[0]?.channel).toBe("customer_wallet");
    expect(rowA[0]?.settled).toBe("true");

    // A repeated gateway callback for A changes nothing.
    const replay = await applyPaymobWebhook(880_001, 880_104, amountCents, true, false);
    expect(replay[0]?.payload?.ignored).toBe(true);

    // Provider cancels: the customer gets the funding payment (B) back exactly once,
    // on top of the single superseded-excess credit for A.
    await asServiceRole(db, () =>
      db.query(
        "UPDATE public.bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
        [bookingId],
      ),
    );
    await asServiceRole(db, () =>
      db.query("SELECT public.credit_customer_wallet_provider_cancelled($1)", [bookingId]),
    );
    await asServiceRole(db, () =>
      db.query("SELECT public.credit_customer_wallet_provider_cancelled($1)", [bookingId]),
    );

    const credits = await queryRows<{ reason: string; payment_id: string; amount: string }>(
      db,
      `SELECT reason, payment_id::text AS payment_id, amount::text AS amount
       FROM public.customer_wallet_entries
       WHERE booking_id = $1 AND direction = 'credit'
       ORDER BY created_at`,
      [bookingId],
    );
    expect(credits.map((c) => c.reason).sort()).toEqual(
      ["paymob_superseded_capture", "provider_cancelled"].sort(),
    );
    const cancelCredit = credits.find((c) => c.reason === "provider_cancelled");
    expect(cancelCredit?.payment_id).toBe(paymentB);
    expect(Number(cancelCredit?.amount)).toBeCloseTo(Number(amount), 2);

    const statuses = await queryRows<{ id: string; status: string }>(
      db,
      "SELECT id::text AS id, status::text AS status FROM public.payments WHERE id IN ($1, $2)",
      [paymentA, paymentB],
    );
    expect(statuses.find((r) => r.id === paymentB)?.status).toBe("refunded");
    expect(statuses.find((r) => r.id === paymentA)?.status).toBe("refunded");
  });
});

describe("audit money batch — #438 online InstaPay capture guard", () => {
  it("rejects provider capture of manual transfer on online booking", async () => {
    const bookingId = await seedOnlineBookingPastEnd();
    const instapayMethod = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.payment_methods WHERE code = 'instapay' LIMIT 1`,
    );
    const methodId = instapayMethod[0]?.id;
    if (!methodId) throw new Error("expected instapay payment method");

    const due = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due
       FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const amount = due[0]?.due ?? "200";
    const paymentId = randomUUID();
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status,
           payment_method_id, payment_method_type, payment_method_code
         ) VALUES ($1, $2, $3, $5::numeric, 'pending_review', $4, 'manual_transfer', 'instapay')`,
        [paymentId, bookingId, IDS.customer, methodId, amount],
      ),
    );

    const attempt = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_review_manual_payment($1::uuid, 'capture', NULL)`,
      [paymentId],
    );
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toMatch(/cannot be captured|admin review|Online payments/i);
  });
});
