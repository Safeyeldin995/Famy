import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
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

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function bindPaymobOrder(paymobId: string, orderId: number, integrationId = 77) {
  await asServiceRole(db, () =>
    db.query(
      `UPDATE public.payments
       SET paymob_order_id = $2, paymob_integration_id = $3
       WHERE id = $1`,
      [paymobId, orderId, integrationId],
    ),
  );
}

describe("audit security money batch", { concurrent: false }, () => {
  it("provider cannot SELECT payments row directly but can call provider_booking_payment without metadata", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'paymob_client_secret', 'secret-should-not-leak',
           'paymob_checkout_url', 'https://paymob.example/checkout'
         ),
         proof_path = 'proofs/hidden.jpg'
         WHERE id = $1`,
        [paymobId],
      ),
    );

    const direct = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT id, metadata, proof_path FROM public.payments WHERE booking_id = $1",
      [bookingId],
    );
    expect(direct.error).toBeUndefined();
    expect(direct.rows ?? []).toHaveLength(0);

    const rpc = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.provider_booking_payment($1::uuid) AS payload",
      [bookingId],
    );
    expect(rpc.error).toBeUndefined();
    const payload = rpc.rows?.[0]?.payload as Record<string, unknown> | null;
    expect(payload).toBeTruthy();
    expect(payload).not.toHaveProperty("metadata");
    expect(payload).not.toHaveProperty("proof_path");
    expect(payload).not.toHaveProperty("paymob_order_id");
    expect(payload).not.toHaveProperty("paymob_integration_id");
    expect(payload).not.toHaveProperty("client_secret");
    expect(payload).not.toHaveProperty("checkout_url");
    expect(payload?.booking_id).toBe(bookingId);
    expect(payload).toHaveProperty("status");
    expect(payload).toHaveProperty("amount");
    expect(payload).toHaveProperty("payment_method_type");
  });

  it("late capture shortfall records captured + metadata when wallet reclaim is unavailable", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);

    const topUp = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 40, 'shortfall top-up', NULL)",
      [IDS.customer],
    );
    expect(topUp.error).toBeUndefined();

    const applied = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_apply_wallet_at_checkout($1::uuid)",
      [paymobId],
    );
    expect(applied.error).toBeUndefined();

    await asServiceRole(db, () =>
      db.query(`SELECT public.restore_customer_wallet_checkout_debit($1::uuid)`, [bookingId]),
    );

    const available = await queryRows<{ available: string }>(
      db,
      `SELECT available_amount::text AS available FROM public.customer_wallet_balances($1)`,
      [IDS.customer],
    );
    const availableAmount = Number(available[0]?.available ?? 0);
    if (availableAmount > 0) {
      const drain = await tryAsUser(
        db,
        IDS.adminUser,
        "SELECT public.admin_adjust_customer_wallet($1, 'debit', $2, 'drain for shortfall', NULL)",
        [IDS.customer, availableAmount],
      );
      expect(drain.error).toBeUndefined();
    }

    const orderId = 880011;
    await bindPaymobOrder(paymobId, orderId);

    const amountRows = await queryRows<{ amount: string }>(
      db,
      "SELECT amount::text AS amount FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const amountCents = Math.round(Number(amountRows[0]!.amount) * 100);

    const webhook = await asServiceRole(db, () =>
      queryRows<{ payload: { ok?: boolean; status?: string } }>(
        db,
        `SELECT public.paymob_apply_transaction_webhook(
           880011, $1::bigint, 77, 'EGP', true, false, $2::bigint, 'txn-shortfall'
         ) AS payload`,
        [orderId, amountCents],
      ),
    );
    expect(webhook[0]?.payload?.ok).toBe(true);
    expect(webhook[0]?.payload?.status).toBe("captured");

    const payment = await queryRows<{
      status: string;
      shortfall: string | null;
      review: string | null;
    }>(
      db,
      `SELECT
         status::text AS status,
         metadata->>'capture_shortfall' AS shortfall,
         metadata->>'needs_admin_review' AS review
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(payment[0]?.status).toBe("captured");
    expect(Number(payment[0]?.shortfall)).toBeGreaterThan(0);
    expect(payment[0]?.review).toBe("true");

    const events = await queryRows<{ outcome: string }>(
      db,
      `SELECT outcome FROM public.paymob_webhook_events WHERE paymob_transaction_id = 880011`,
    );
    expect(events[0]?.outcome).toBe("captured");
  });

  it("refund webhook flags payment without changing status or moving money", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const orderId = 880012;
    await bindPaymobOrder(paymobId, orderId);
    await asServiceRole(db, () =>
      db.exec(`
        SELECT set_config('app.ledger_internal_capture', 'on', true);
        UPDATE public.payments
        SET status = 'captured', captured_at = now()
        WHERE id = '${paymobId}';
      `),
    );

    const before = await queryRows<{ amount: string; status: string }>(
      db,
      "SELECT amount::text AS amount, status::text AS status FROM public.payments WHERE id = $1",
      [paymobId],
    );

    const first = await asServiceRole(db, () =>
      queryRows<{ payload: { ok?: boolean; status?: string; duplicate?: boolean } }>(
        db,
        `SELECT public.paymob_apply_refund_webhook(880012, $1::bigint, 12345, false, '{}'::jsonb) AS payload`,
        [orderId],
      ),
    );
    expect(first[0]?.payload?.ok).toBe(true);
    expect(first[0]?.payload?.status).toBe("captured");

    const after = await queryRows<{
      amount: string;
      status: string;
      recorded: string | null;
      cents: string | null;
      voided: string | null;
      review: string | null;
    }>(
      db,
      `SELECT
         amount::text AS amount,
         status::text AS status,
         metadata->>'gateway_refund_recorded_at' AS recorded,
         metadata->>'gateway_refund_amount_cents' AS cents,
         metadata->>'gateway_refund_voided' AS voided,
         metadata->>'needs_admin_review' AS review
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(after[0]?.status).toBe(before[0]?.status);
    expect(after[0]?.amount).toBe(before[0]?.amount);
    expect(after[0]?.recorded).toBeTruthy();
    expect(after[0]?.cents).toBe("12345");
    expect(after[0]?.voided).toBe("false");
    expect(after[0]?.review).toBe("true");

    const event = await queryRows<{ outcome: string }>(
      db,
      `SELECT outcome FROM public.paymob_webhook_events WHERE paymob_transaction_id = 880012`,
    );
    expect(event[0]?.outcome).toBe("refunded");

    const second = await asServiceRole(db, () =>
      queryRows<{ payload: { duplicate?: boolean } }>(
        db,
        `SELECT public.paymob_apply_refund_webhook(880012, $1::bigint, 12345, false, '{}'::jsonb) AS payload`,
        [orderId],
      ),
    );
    expect(second[0]?.payload?.duplicate).toBe(true);
  });

  it("account_deletion_check returns funds_owed_to_user for wallet credit before active_bookings", async () => {
    await seedLifecycleBooking(db, { status: "pending" });
    const credit = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 12.5, 'deletion-block credit', NULL)",
      [IDS.customer],
    );
    expect(credit.error).toBeUndefined();

    const check = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.account_deletion_check() AS payload",
    );
    expect(check.error).toBeUndefined();
    expect(check.rows?.[0]?.payload).toEqual({ ok: false, reason: "funds_owed_to_user" });
  });

  it("anonymize_account deletes provider payout methods", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "completed" });
    await setBookingStatusAsSystem(db, bookingId, "completed");
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET status = 'completed'
        WHERE provider_id = '${IDS.provider}'
          AND status NOT IN ('completed', 'cancelled', 'no_show');
      `),
    );

    const inserted = await tryAsUser(
      db,
      IDS.providerUser,
      `INSERT INTO public.provider_payout_methods (
         provider_id, method, holder_name, wallet_phone
       ) VALUES (
         '${IDS.provider}', 'vodafone_cash', 'Mona Ali', '01012345678'
       ) RETURNING id`,
    );
    expect(inserted.error).toBeUndefined();

    const before = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.provider_payout_methods WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(Number(before[0]?.n)).toBeGreaterThan(0);

    await asServiceRole(db, () =>
      db.query(`SELECT public.anonymize_account($1::uuid)`, [IDS.providerUser]),
    );

    const after = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.provider_payout_methods WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(after[0]?.n).toBe("0");
  });
});
