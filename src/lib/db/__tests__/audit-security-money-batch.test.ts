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

  it("provider_review_manual_payment captures cash after completed booking", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "completed" });
    await setBookingStatusAsSystem(db, bookingId, "completed");
    const { cashId } = await seedPaymentsForBooking(db, bookingId);

    const capture = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_review_manual_payment($1::uuid, 'capture') AS payload`,
      [cashId],
    );
    expect(capture.error).toBeUndefined();
    const payload = capture.rows?.[0]?.payload as { status?: string } | undefined;
    expect(payload?.status).toBe("captured");

    const row = await queryRows<{ status: string; captured_at: string | null }>(
      db,
      `SELECT status::text AS status, captured_at::text AS captured_at FROM public.payments WHERE id = $1`,
      [cashId],
    );
    expect(row[0]?.status).toBe("captured");
    expect(row[0]?.captured_at).toBeTruthy();
  });

  it("refund webhook after capture keeps capture event and flags payment metadata", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const orderId = 880012;
    const txnId = 880012;
    await bindPaymobOrder(paymobId, orderId);

    const amountRows = await queryRows<{ amount: string }>(
      db,
      "SELECT amount::text AS amount FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const amountCents = Math.round(Number(amountRows[0]!.amount) * 100);

    const captureWebhook = await asServiceRole(db, () =>
      queryRows<{ payload: { ok?: boolean; status?: string } }>(
        db,
        `SELECT public.paymob_apply_transaction_webhook(
           $1::bigint, $2::bigint, 77, 'EGP', true, false, $3::bigint, 'txn-capture-refund'
         ) AS payload`,
        [txnId, orderId, amountCents],
      ),
    );
    expect(captureWebhook[0]?.payload?.ok).toBe(true);
    expect(captureWebhook[0]?.payload?.status).toBe("captured");

    const before = await queryRows<{ amount: string; status: string }>(
      db,
      "SELECT amount::text AS amount, status::text AS status FROM public.payments WHERE id = $1",
      [paymobId],
    );

    const first = await asServiceRole(db, () =>
      queryRows<{
        payload: {
          ok?: boolean;
          status?: string;
          duplicate?: boolean;
          capture_preserved?: boolean;
        };
      }>(
        db,
        `SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, 12345, false, '{}'::jsonb) AS payload`,
        [txnId, orderId],
      ),
    );
    expect(first[0]?.payload?.ok).toBe(true);
    expect(first[0]?.payload?.status).toBe("captured");
    expect(first[0]?.payload?.capture_preserved).toBe(true);

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
      `SELECT outcome FROM public.paymob_webhook_events WHERE paymob_transaction_id = $1`,
      [txnId],
    );
    expect(event[0]?.outcome).toBe("captured");

    const second = await asServiceRole(db, () =>
      queryRows<{ payload: { duplicate?: boolean } }>(
        db,
        `SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, 12345, false, '{}'::jsonb) AS payload`,
        [txnId, orderId],
      ),
    );
    expect(second[0]?.payload?.duplicate).toBe(true);
  });

  it("unmapped capture is queued for admin and reconciles when order mapping exists", async () => {
    const unmappedOrderId = 880099;
    const unmappedTxnId = 880099;

    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const amountRows = await queryRows<{ amount: string }>(
      db,
      "SELECT amount::text AS amount FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const amountCents = Math.round(Number(amountRows[0]!.amount) * 100);

    const unmapped = await asServiceRole(db, () =>
      queryRows<{ payload: { unmapped_order?: boolean } }>(
        db,
        `SELECT public.paymob_apply_transaction_webhook(
           $1::bigint, $2::bigint, 77, 'EGP', true, false, $3::bigint, 'orphan-capture'
         ) AS payload`,
        [unmappedTxnId, unmappedOrderId, amountCents],
      ),
    );
    expect(unmapped[0]?.payload?.unmapped_order).toBe(true);

    const stored = await queryRows<{ order_id: string; reconciled: string | null }>(
      db,
      `SELECT paymob_order_id::text AS order_id, reconciled_payment_id::text AS reconciled
       FROM public.paymob_unmapped_captures WHERE paymob_transaction_id = $1`,
      [unmappedTxnId],
    );
    expect(stored[0]?.order_id).toBe(String(unmappedOrderId));
    expect(stored[0]?.reconciled).toBeNull();

    const counts = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_payment_queue_counts() AS payload",
    );
    expect(counts.error).toBeUndefined();
    const countPayload = counts.rows?.[0]?.payload as { needs_action?: number } | undefined;
    expect(Number(countPayload?.needs_action ?? 0)).toBeGreaterThanOrEqual(1);

    const queue = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue('needs_action', '', 50, 0) AS payload`,
    );
    expect(queue.error).toBeUndefined();
    const items = (queue.rows?.[0]?.payload as { items?: unknown[] } | undefined)?.items ?? [];
    const hasUnmapped = items.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { metadata?: { paymob_unmapped?: boolean } }).metadata?.paymob_unmapped === true &&
        (item as { metadata?: { paymob_order_id?: number } }).metadata?.paymob_order_id ===
          unmappedOrderId,
    );
    expect(hasUnmapped).toBe(true);

    await bindPaymobOrder(paymobId, unmappedOrderId);

    const replay = await asServiceRole(db, () =>
      queryRows<{ payload: { ok?: boolean; duplicate?: boolean; status?: string } }>(
        db,
        `SELECT public.paymob_apply_transaction_webhook(
           $1::bigint, $2::bigint, 77, 'EGP', true, false, $3::bigint, 'orphan-capture'
         ) AS payload`,
        [unmappedTxnId, unmappedOrderId, amountCents],
      ),
    );
    expect(replay[0]?.payload?.ok).toBe(true);
    expect(replay[0]?.payload?.status).toBe("captured");

    const payment = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(payment[0]?.status).toBe("captured");

    const reconciled = await queryRows<{ reconciled: string | null; needs_review: boolean }>(
      db,
      `SELECT reconciled_payment_id::text AS reconciled, needs_admin_review AS needs_review
       FROM public.paymob_unmapped_captures WHERE paymob_transaction_id = $1`,
      [unmappedTxnId],
    );
    expect(reconciled[0]?.reconciled).toBe(paymobId);
    expect(reconciled[0]?.needs_review).toBe(false);
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
