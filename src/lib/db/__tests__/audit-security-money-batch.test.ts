import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { paymentCapturedForJoin } from "@/lib/livekit/sessionAccess";
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
      db.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2`, [bookingId, paymobId]),
    );
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
    expect(payload?.has_proof).toBe(true);
  });

  it("late capture shortfall records captured + metadata when wallet reclaim is unavailable", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);

    const topUp = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 40, 'shortfall top-up', NULL, gen_random_uuid()::text)",
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
        "SELECT public.admin_adjust_customer_wallet($1, 'debit', $2, 'drain for shortfall', NULL, gen_random_uuid()::text)",
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

  it("provider_booking_payment prefers captured funding attempt over newer pending retry", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const dueRows = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const amount = dueRows[0]?.due ?? "200";
    const paymobMethod = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.payment_methods WHERE code = 'paymob' LIMIT 1`,
    );
    const olderId = randomUUID();
    const newerId = randomUUID();
    await asServiceRole(db, async () => {
      await db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status,
           payment_method_id, payment_method_type, payment_method_code, method,
           created_at, metadata
         ) VALUES
         (
           $1, $2, $3, $4::numeric, 'pending', $5, 'online', 'paymob', 'paymob',
           now() - interval '2 hours', '{}'::jsonb
         ),
         (
           $6, $2, $3, $4::numeric, 'pending', $5, 'online', 'paymob', 'paymob',
           now(), '{}'::jsonb
         )`,
        [olderId, bookingId, IDS.customer, amount, paymobMethod[0]!.id, newerId],
      );
      await db.query(`SELECT set_config('app.ledger_internal_capture', 'on', true)`);
      await db.query(
        `UPDATE public.payments
         SET status = 'captured', captured_at = now() - interval '2 hours'
         WHERE id = $1`,
        [olderId],
      );
      await db.query(`SELECT set_config('app.ledger_internal_capture', 'off', true)`);
    });

    const rpc = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.provider_booking_payment($1::uuid) AS payload",
      [bookingId],
    );
    expect(rpc.error).toBeUndefined();
    const payload = rpc.rows?.[0]?.payload as { id?: string; status?: string } | null;
    expect(payload?.id).toBe(olderId);
    expect(payload?.status).toBe("captured");
  });

  it("provider sees captured Paymob payment via provider_booking_payment (online lesson join gate)", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2`, [bookingId, paymobId]),
    );
    const amountRows = await queryRows<{ amount: string }>(
      db,
      "SELECT amount::text AS amount FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const amountCents = Math.round(Number(amountRows[0]!.amount) * 100);
    const orderId = 881234;
    await bindPaymobOrder(paymobId, orderId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET payment_method_type = 'online', payment_method_code = 'paymob', method = 'paymob'
         WHERE id = $1`,
        [paymobId],
      ),
    );

    await asServiceRole(db, () =>
      queryRows(
        db,
        `SELECT public.paymob_apply_transaction_webhook(
           88123401::bigint, $1::bigint, 77, 'EGP', true, false, $2::bigint, 'capture'
         )`,
        [orderId, amountCents],
      ),
    );

    const rpc = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.provider_booking_payment($1::uuid) AS payload",
      [bookingId],
    );
    expect(rpc.error).toBeUndefined();
    const payload = rpc.rows?.[0]?.payload as {
      status?: string;
      payment_method_type?: string;
      amount?: number;
    } | null;
    expect(payload?.status).toBe("captured");
    expect(payload?.payment_method_type).toBe("online");
    expect(paymentCapturedForJoin(payload)).toBe(true);
    expect(Number(payload?.amount ?? 0)).toBeGreaterThan(0);
  });

  it("admin_resolve_paymob_flag clears paymobNeedsAction for payment metadata flags", async () => {
    const baselineCounts = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue_counts() AS payload`,
    );
    expect(baselineCounts.error).toBeUndefined();
    const baselineNeeds = Number(
      (baselineCounts.rows?.[0]?.payload as { needs_action?: number } | undefined)?.needs_action ?? 0,
    );

    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET metadata = jsonb_build_object(
           'capture_shortfall', 25,
           'needs_admin_review', true
         )
         WHERE id = $1`,
        [paymobId],
      ),
    );

    const before = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_situation(
         'captured', 'online', 'paymob', NULL, 'confirmed', false,
         (SELECT metadata FROM public.payments WHERE id = $1::uuid)
       ) AS situation`,
      [paymobId],
    );
    expect(before.rows?.[0]?.situation).toBe("paymobNeedsAction");

    const flaggedCounts = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue_counts() AS payload`,
    );
    expect(
      Number(
        (flaggedCounts.rows?.[0]?.payload as { needs_action?: number } | undefined)?.needs_action ?? 0,
      ),
    ).toBe(baselineNeeds + 1);

    const resolved = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_resolve_paymob_flag($1::uuid, NULL, 'reconciled in Paymob dashboard') AS payload`,
      [paymobId],
    );
    expect(resolved.error).toBeUndefined();

    const after = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_situation(
         'captured', 'online', 'paymob', NULL, 'confirmed', false,
         (SELECT metadata FROM public.payments WHERE id = $1::uuid)
       ) AS situation`,
      [paymobId],
    );
    expect(after.rows?.[0]?.situation).toBe("paid");

    const afterCounts = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_queue_counts() AS payload`,
    );
    expect(
      Number((afterCounts.rows?.[0]?.payload as { needs_action?: number } | undefined)?.needs_action ?? 0),
    ).toBe(baselineNeeds);
  });

  it("admin wallet idempotency keys are namespaced per customer", async () => {
    const key = `idem-${Date.now()}`;
    const first = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'test credit', NULL, $2) AS entry_id`,
      [IDS.customer, key],
    );
    expect(first.error).toBeUndefined();
    const firstId = first.rows?.[0]?.entry_id;
    expect(firstId).toBeTruthy();

    const retry = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'test credit', NULL, $2) AS entry_id`,
      [IDS.customer, key],
    );
    expect(retry.rows?.[0]?.entry_id).toBe(firstId);

    const otherKey = `${key}-other`;
    const different = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'different key', NULL, $2) AS entry_id`,
      [IDS.customer, otherKey],
    );
    expect(different.error).toBeUndefined();
    expect(different.rows?.[0]?.entry_id).not.toBe(firstId);

    const stored = await queryRows<{ idempotency_key: string }>(
      db,
      `SELECT idempotency_key FROM public.customer_wallet_entries WHERE customer_id = $1 AND idempotency_key LIKE $2`,
      [IDS.customer, `admin_wallet:${IDS.customer}:${key}`],
    );
    expect(stored[0]?.idempotency_key).toBe(`admin_wallet:${IDS.customer}:${key}`);

    const otherCustomer = IDS.otherProviderUser;
    const cross = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'cross customer', NULL, $2) AS entry_id`,
      [otherCustomer, key],
    );
    expect(cross.error).toBeUndefined();
    expect(cross.rows?.[0]?.entry_id).not.toBe(firstId);
  });

  it("backfill moves pending Paymob checkout secrets to payment_paymob_checkout", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const dueRows = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const amount = dueRows[0]?.due ?? "200";
    const payId = randomUUID();
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status,
           payment_method_id, payment_method_type, payment_method_code, method, metadata
         )
         SELECT $1, $2, $3, $4::numeric, 'pending', pm.id, 'online', 'paymob', 'paymob',
           jsonb_build_object(
             'paymob_client_secret', 'legacy-secret',
             'paymob_checkout_url', 'https://paymob.test/checkout'
           )
         FROM public.payment_methods pm WHERE pm.code = 'paymob' LIMIT 1`,
        [payId, bookingId, IDS.customer, amount],
      ),
    );

    await asServiceRole(db, () =>
      db.exec(`
        INSERT INTO public.payment_paymob_checkout (
          payment_id, checkout_url, client_secret, intention_id, updated_at
        )
        SELECT
          p.id,
          NULLIF(p.metadata->>'paymob_checkout_url', ''),
          NULLIF(p.metadata->>'paymob_client_secret', ''),
          NULLIF(p.metadata->>'paymob_intention_id', ''),
          now()
        FROM public.payments p
        WHERE p.id = '${payId}'
        ON CONFLICT (payment_id) DO UPDATE SET
          checkout_url = COALESCE(EXCLUDED.checkout_url, public.payment_paymob_checkout.checkout_url),
          client_secret = COALESCE(EXCLUDED.client_secret, public.payment_paymob_checkout.client_secret);

        UPDATE public.payments p
        SET metadata = metadata - 'paymob_client_secret' - 'paymob_checkout_url'
        WHERE p.id = '${payId}';
      `),
    );

    const checkout = await queryRows<{ secret: string | null }>(
      db,
      `SELECT client_secret AS secret FROM public.payment_paymob_checkout WHERE payment_id = $1`,
      [payId],
    );
    expect(checkout[0]?.secret).toBe("legacy-secret");

    const meta = await queryRows<{ has_secret: boolean }>(
      db,
      `SELECT (metadata ? 'paymob_client_secret') AS has_secret FROM public.payments WHERE id = $1`,
      [payId],
    );
    expect(meta[0]?.has_secret).toBe(false);
  });

  it("backfill strips checkout secrets from all paymob payments, not only pending", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const dueRows = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const amount = dueRows[0]?.due ?? "200";
    const payId = randomUUID();
    await asServiceRole(db, async () => {
      await db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status,
           payment_method_id, payment_method_type, payment_method_code, method, metadata
         )
         SELECT $1, $2, $3, $4::numeric, 'pending', pm.id, 'online', 'paymob', 'paymob',
           jsonb_build_object(
             'paymob_client_secret', 'captured-secret',
             'paymob_checkout_url', 'https://paymob.test/old'
           )
         FROM public.payment_methods pm WHERE pm.code = 'paymob' LIMIT 1`,
        [payId, bookingId, IDS.customer, amount],
      );
      await db.query(`SELECT set_config('app.ledger_internal_capture', 'on', true)`);
      await db.query(
        `UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = $1`,
        [payId],
      );
      await db.query(`SELECT set_config('app.ledger_internal_capture', 'off', true)`);
    });

    await asServiceRole(db, () =>
      db.query(`
        UPDATE public.payments p
        SET metadata = metadata - 'paymob_client_secret' - 'paymob_checkout_url'
        WHERE p.payment_method_code = 'paymob'
          AND (
            p.metadata ? 'paymob_client_secret'
            OR p.metadata ? 'paymob_checkout_url'
          )
      `),
    );

    const meta = await queryRows<{ has_secret: boolean; has_url: boolean }>(
      db,
      `SELECT
         (metadata ? 'paymob_client_secret') AS has_secret,
         (metadata ? 'paymob_checkout_url') AS has_url
       FROM public.payments WHERE id = $1`,
      [payId],
    );
    expect(meta[0]?.has_secret).toBe(false);
    expect(meta[0]?.has_url).toBe(false);
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
      db.query(`SELECT public.anonymize_account($1::uuid, false)`, [IDS.providerUser]),
    );

    const after = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.provider_payout_methods WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(after[0]?.n).toBe("0");
  });
});
