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
 * Audit batch A (money / database): #516 #517 #518 #519 #522 #523 #524 #525 #526 #527.
 */
let db: PGlite;
let providerReason: string;
let customerReason: string;
let adminReason: string;

const PAYMOB_INTEGRATION_ID = 456;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  const provider = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency'",
  );
  providerReason = provider[0]!.id;
  const customer = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.cancellation_reasons
     WHERE is_active AND actor_type IN ('customer', 'any') AND NOT requires_note
       AND 'confirmed' = ANY(applicable_statuses)
     ORDER BY display_order LIMIT 1`,
  );
  customerReason = customer[0]!.id;
  const admin = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.cancellation_reasons
     WHERE is_active AND actor_type IN ('admin', 'any')
       AND 'confirmed' = ANY(applicable_statuses)
     ORDER BY display_order LIMIT 1`,
  );
  adminReason = admin[0]!.id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function walletBalance(customerId: string = IDS.customer): Promise<number> {
  const rows = await queryRows<{ b: string }>(
    db,
    `SELECT COALESCE(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS b
     FROM public.customer_wallet_entries WHERE customer_id = $1`,
    [customerId],
  );
  return Number(rows[0]?.b ?? 0);
}

async function topUpWallet(amount: number) {
  const r = await tryAsUser(
    db,
    IDS.adminUser,
    "SELECT public.admin_adjust_customer_wallet($1, 'credit', $2, 'batch A top-up', NULL, $3)",
    [IDS.customer, amount, randomUUID()],
  );
  expect(r.error).toBeUndefined();
}

async function applyWalletAtCheckout(paymentId: string): Promise<number> {
  const r = await tryAsUser(
    db,
    IDS.customer,
    "SELECT public.customer_apply_wallet_at_checkout($1::uuid) AS payload",
    [paymentId],
  );
  expect(r.error).toBeUndefined();
  return Number((r.rows?.[0]?.payload as { wallet_spent?: number })?.wallet_spent ?? 0);
}

async function captureAsSystem(paymentId: string) {
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymentId}';
    `),
  );
}

async function makeOnline(bookingId: string, endsAt = "2026-11-25T17:30:00+00") {
  await db.exec(`
    ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
    UPDATE public.bookings
    SET service_mode = 'online',
        start_at = timestamptz '${endsAt}' - interval '1 hour',
        end_at = timestamptz '${endsAt}',
        online_session_outcome = NULL,
        price_total = 200,
        price_provider_net = 160
    WHERE id = '${bookingId}';
    ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
  `);
}

async function seedPaymobOnly(bookingId: string): Promise<string> {
  const method = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.payment_methods WHERE code = 'paymob' LIMIT 1",
  );
  const id = randomUUID();
  await asServiceRole(db, () =>
    db.query(
      `INSERT INTO public.payments (
         id, booking_id, customer_id, amount, status, payment_method_id,
         payment_method_type, payment_method_code, method, currency, metadata
       )
       SELECT $1, b.id, b.customer_id, b.price_total, 'pending', $3, 'online', 'paymob', 'paymob', 'EGP', '{}'::jsonb
       FROM public.bookings b WHERE b.id = $2`,
      [id, bookingId, method[0]!.id],
    ),
  );
  return id;
}

async function paidOnlineLessonPastEnd() {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  await makeOnline(bookingId);
  const paymobId = await seedPaymobOnly(bookingId);
  await captureAsSystem(paymobId);
  return { bookingId, paymobId };
}

async function attend(bookingId: string, who: Array<"customer" | "provider">) {
  for (const participant of who) {
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.session_events (booking_id, participant, joined_at, left_at)
         SELECT id, $2, start_at, end_at FROM public.bookings WHERE id = $1`,
        [bookingId, participant],
      ),
    );
  }
}

async function resolveSessions() {
  await asServiceRole(db, () =>
    queryRows(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
  );
}

async function bookingRow(bookingId: string) {
  const rows = await queryRows<{ status: string; party: string | null; outcome: string | null }>(
    db,
    `SELECT status::text AS status, no_show_party AS party, online_session_outcome AS outcome
     FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0]!;
}

async function walletEntries(bookingId: string, reason: string) {
  const rows = await queryRows<{ count: string; sum: string }>(
    db,
    `SELECT count(*)::text AS count, COALESCE(sum(amount), 0)::text AS sum
     FROM public.customer_wallet_entries WHERE booking_id = $1 AND reason = $2`,
    [bookingId, reason],
  );
  return { count: Number(rows[0]!.count), sum: Number(rows[0]!.sum) };
}

async function openReviews(bookingId: string) {
  const rows = await queryRows<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM public.online_session_admin_reviews
     WHERE booking_id = $1 AND status = 'open'`,
    [bookingId],
  );
  return Number(rows[0]!.n);
}

async function ledgerSum(bookingId: string, kind: string) {
  const rows = await queryRows<{ n: string; s: string }>(
    db,
    `SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::text AS s
     FROM public.provider_ledger_entries WHERE booking_id = $1 AND kind = $2`,
    [bookingId, kind],
  );
  return { count: Number(rows[0]!.n), sum: Number(rows[0]!.s) };
}

describe("#516 wallet part of an unpaid checkout comes back on every cancel path", () => {
  it("provider cancel releases the reserved wallet amount once", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await topUpWallet(40);
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const spent = await applyWalletAtCheckout(paymobId);
    expect(spent).toBeGreaterThan(0);
    const before = await walletBalance();

    const r = await tryAsUser(db, IDS.providerUser, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      providerReason,
    ]);
    expect(r.error).toBeUndefined();

    const released = await walletEntries(bookingId, "checkout_release");
    expect(released.count).toBe(1);
    expect(released.sum).toBeCloseTo(spent, 2);
    expect(await walletBalance()).toBeCloseTo(before + spent, 2);
  });

  it("admin cancel releases it too", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await topUpWallet(30);
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const spent = await applyWalletAtCheckout(paymobId);

    const r = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.cancel_booking($1, $2, 'support request')",
      [bookingId, adminReason],
    );
    expect(r.error).toBeUndefined();
    const released = await walletEntries(bookingId, "checkout_release");
    expect(released.count).toBe(1);
    expect(released.sum).toBeCloseTo(spent, 2);
  });

  it("an expired request releases it", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await topUpWallet(20);
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const spent = await applyWalletAtCheckout(paymobId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings
         SET status = 'pending', created_at = now() - interval '30 days'
         WHERE id = $1`,
        [bookingId],
      ),
    );

    await asServiceRole(db, () => queryRows(db, "SELECT public.expire_pending_bookings()"));

    expect((await bookingRow(bookingId)).status).toBe("cancelled");
    const released = await walletEntries(bookingId, "checkout_release");
    expect(released.count).toBe(1);
    expect(released.sum).toBeCloseTo(spent, 2);
  });

  it("the customer can release it on a cancelled booking even with a pending card row", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await topUpWallet(15);
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const spent = await applyWalletAtCheckout(paymobId);
    // Simulate a cancel that happened before this fix (no release yet).
    await setBookingStatusAsSystem(db, bookingId, "cancelled");

    const r = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_release_booking_checkout_wallet($1)",
      [bookingId],
    );
    expect(r.error).toBeUndefined();
    const again = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_release_booking_checkout_wallet($1)",
      [bookingId],
    );
    expect(again.error).toBeUndefined();
    const released = await walletEntries(bookingId, "checkout_release");
    expect(released.count).toBe(1);
    expect(released.sum).toBeCloseTo(spent, 2);
  });
});

describe("#519 provider cancel refunds only the money actually held", () => {
  it("does not credit a wallet part that was already released", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query("UPDATE public.bookings SET price_total = 200, price_provider_net = 160 WHERE id = $1", [
        bookingId,
      ]),
    );
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.exec(`
        SELECT set_config('app.ledger_internal_capture', 'on', true);
        SELECT set_config('app.wallet_checkout_adjust', 'on', true);
        UPDATE public.payments
        SET status = 'captured', captured_at = now(), amount = 150,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'checkout_total', 200,
              'wallet_applied', 50,
              'wallet_checkout_released', 50,
              'capture_shortfall', 50,
              'needs_admin_review', true
            )
        WHERE id = '${paymobId}';
      `),
    );

    const r = await tryAsUser(db, IDS.providerUser, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      providerReason,
    ]);
    expect(r.error).toBeUndefined();
    const credited = await walletEntries(bookingId, "provider_cancelled");
    expect(credited.count).toBe(1);
    expect(credited.sum).toBeCloseTo(150, 2);
  });
});

describe("#518 a wallet-refunded payment is not 'refund due'", () => {
  it("customer cancel of a paid online lesson shows as refunded, not refundDue", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await makeOnline(bookingId, "2027-01-10T10:00:00+00");
    const paymobId = await seedPaymobOnly(bookingId);
    await captureAsSystem(paymobId);

    const r = await tryAsUser(db, IDS.customer, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      customerReason,
    ]);
    expect(r.error).toBeUndefined();
    expect((await walletEntries(bookingId, "customer_cancelled_refund")).count).toBe(1);

    const situation = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_payment_situation(
         p.status::text, p.payment_method_type, p.method::text, p.proof_path, b.status::text, false, p.metadata
       ) AS s
       FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
       WHERE p.id = $1`,
      [paymobId],
    );
    expect(situation.error).toBeUndefined();
    expect(["refunded", "partiallyRefunded"]).toContain(situation.rows?.[0]?.s);
  });
});

describe("#517 online attendance is settled, not left open", () => {
  it("tutor absent: one full wallet refund, booking closed, no tutor payout, admin review", async () => {
    const { bookingId, paymobId } = await paidOnlineLessonPastEnd();
    const funded = await queryRows<{ f: string }>(
      db,
      "SELECT public.payment_checkout_funded_total(p)::text AS f FROM public.payments p WHERE id = $1",
      [paymobId],
    );
    const before = await walletBalance();
    await attend(bookingId, ["customer"]);

    await resolveSessions();
    await resolveSessions();

    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("provider_absent");
    expect(row.status).toBe("no_show");
    expect(row.party).toBe("provider");
    const refund = await walletEntries(bookingId, "online_no_show_refund");
    expect(refund.count).toBe(1);
    expect(refund.sum).toBeCloseTo(Number(funded[0]!.f), 2);
    expect(await walletBalance()).toBeCloseTo(before + Number(funded[0]!.f), 2);
    expect((await ledgerSum(bookingId, "online_provider_share")).count).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);

    const pay = await queryRows<{ status: string }>(
      db,
      "SELECT status::text AS status FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(pay[0]?.status).toBe("refunded");

    const notes = await queryRows<{ user_id: string; body_ar: string }>(
      db,
      `SELECT user_id::text, body_ar FROM public.notifications
       WHERE booking_id = $1 AND type = 'online_attendance_provider_absent'`,
      [bookingId],
    );
    expect(notes.map((n) => n.user_id).sort()).toEqual([IDS.customer, IDS.providerUser].sort());
    // The generic "no-show reported" notification is not sent for this automatic case.
    const generic = await queryRows<{ n: string }>(
      db,
      "SELECT count(*)::text AS n FROM public.notifications WHERE booking_id = $1 AND type = 'booking_no_show'",
      [bookingId],
    );
    expect(generic[0]?.n).toBe("0");
  });

  it("both absent: lesson cancelled, full wallet refund, admin review", async () => {
    const { bookingId, paymobId } = await paidOnlineLessonPastEnd();
    // A connection that dropped instantly: neither side really attended.
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.session_events (booking_id, participant, joined_at, left_at)
         SELECT id, 'customer', start_at, start_at FROM public.bookings WHERE id = $1`,
        [bookingId],
      ),
    );
    const funded = await queryRows<{ f: string }>(
      db,
      "SELECT public.payment_checkout_funded_total(p)::text AS f FROM public.payments p WHERE id = $1",
      [paymobId],
    );
    await resolveSessions();

    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("both_absent");
    expect(row.status).toBe("cancelled");
    const refund = await walletEntries(bookingId, "online_no_show_refund");
    expect(refund.count).toBe(1);
    expect(refund.sum).toBeCloseTo(Number(funded[0]!.f), 2);
    expect((await ledgerSum(bookingId, "online_provider_share")).count).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("student absent: online fee to the tutor, the rest to the wallet, admin review", async () => {
    const { bookingId, paymobId } = await paidOnlineLessonPastEnd();
    await attend(bookingId, ["provider"]);
    const expectedFee = await queryRows<{ f: string }>(
      db,
      "SELECT public.cancellation_fee_for_total(200, 'online')::text AS f",
    );
    const funded = await queryRows<{ f: string }>(
      db,
      "SELECT public.payment_checkout_funded_total(p)::text AS f FROM public.payments p WHERE id = $1",
      [paymobId],
    );
    const fee = Math.min(Number(expectedFee[0]!.f), Number(funded[0]!.f));

    await resolveSessions();

    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("customer_absent");
    expect(row.status).toBe("no_show");
    expect(row.party).toBe("customer");
    const share = await ledgerSum(bookingId, "cancellation_fee_provider_share");
    if (fee > 0) {
      expect(share.count).toBe(1);
      expect(share.sum).toBeCloseTo(fee, 2);
    }
    const refund = await walletEntries(bookingId, "online_no_show_refund");
    const credit = Number(funded[0]!.f) - fee;
    if (credit > 0) {
      expect(refund.count).toBe(1);
      expect(refund.sum).toBeCloseTo(credit, 2);
    }
    // Money conservation: what the student gets back + the tutor's fee = what was paid.
    expect(refund.sum + share.sum).toBeCloseTo(Number(funded[0]!.f), 2);
    expect((await ledgerSum(bookingId, "online_provider_share")).count).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("a lesson the tutor already completed is only reviewed, never refunded", async () => {
    const { bookingId } = await paidOnlineLessonPastEnd();
    await setBookingStatusAsSystem(db, bookingId, "completed");
    await attend(bookingId, ["provider"]);
    await resolveSessions();
    expect((await bookingRow(bookingId)).status).toBe("completed");
    expect((await walletEntries(bookingId, "online_no_show_refund")).count).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("settle_online_session_absence is internal", async () => {
    const r = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.settle_online_session_absence($1, 'provider_absent')",
      [randomUUID()],
    );
    expect(r.ok).toBe(false);
  });
});

describe("money conservation: provider cancel of a wallet + card split", () => {
  it("returns the wallet part and the card part once, as one credit", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await topUpWallet(40);
    // Price above the wallet balance, so the checkout is a real wallet + card split.
    const balance = await walletBalance();
    await asServiceRole(db, () =>
      db.query("UPDATE public.bookings SET price_total = $2, price_provider_net = $3 WHERE id = $1", [
        bookingId,
        balance + 100,
        balance + 50,
      ]),
    );
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const spent = await applyWalletAtCheckout(paymobId);
    expect(spent).toBeCloseTo(balance, 2);
    await captureAsSystem(paymobId);
    const card = await queryRows<{ a: string }>(
      db,
      "SELECT amount::text AS a FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const before = await walletBalance();

    const r = await tryAsUser(db, IDS.providerUser, "SELECT public.cancel_booking($1, $2, NULL)", [
      bookingId,
      providerReason,
    ]);
    expect(r.error).toBeUndefined();

    const credit = await walletEntries(bookingId, "provider_cancelled");
    expect(credit.count).toBe(1);
    expect(Number(card[0]!.a)).toBeCloseTo(100, 2);
    expect(credit.sum).toBeCloseTo(spent + Number(card[0]!.a), 2);
    expect((await walletEntries(bookingId, "checkout_release")).count).toBe(0);
    expect(await walletBalance()).toBeCloseTo(before + spent + Number(card[0]!.a), 2);
  });
});

describe("#526 gateway refunds add up and hold the tutor payout", () => {
  it("sums two partial refunds, ignores a replay, and pays the tutor only after admin resolves", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query("UPDATE public.bookings SET price_total = 200, price_provider_net = 160 WHERE id = $1", [
        bookingId,
      ]),
    );
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET payment_method_type = 'online', payment_method_code = 'paymob', method = 'paymob',
             paymob_order_id = 771001, paymob_integration_id = $2, currency = 'EGP'
         WHERE id = $1`,
        [paymobId, PAYMOB_INTEGRATION_ID],
      ),
    );
    await captureAsSystem(paymobId);

    const refund = (tx: number, cents: number) =>
      asServiceRole(db, () =>
        queryRows<{ r: Record<string, unknown> }>(
          db,
          "SELECT public.paymob_apply_refund_webhook($1::bigint, 771001, $2::bigint, false, '{}'::jsonb) AS r",
          [tx, cents],
        ),
      );
    await refund(771501, 5000);
    await refund(771502, 3000);
    const replay = await refund(771501, 5000);
    expect(replay[0]?.r?.duplicate).toBe(true);

    const meta = await queryRows<{ total: string }>(
      db,
      "SELECT metadata->>'gateway_refund_amount_cents' AS total FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(Number(meta[0]?.total)).toBe(8000);

    await asServiceRole(db, () =>
      db.query(
        "UPDATE public.bookings SET status = 'completed', completed_at = now() WHERE id = $1",
        [bookingId],
      ),
    );
    expect((await ledgerSum(bookingId, "online_provider_share")).count).toBe(0);

    const resolved = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_resolve_paymob_flag($1, NULL, 'handled with the customer')",
      [paymobId],
    );
    expect(resolved.error).toBeUndefined();
    const share = await ledgerSum(bookingId, "online_provider_share");
    expect(share.count).toBe(1);
    expect(share.sum).toBeCloseTo(160, 2);

    // A new refund after the resolution re-opens the flag.
    await refund(771503, 1000);
    const flag = await queryRows<{ resolved: string | null; total: string }>(
      db,
      `SELECT metadata->>'paymob_resolved_at' AS resolved,
              metadata->>'gateway_refund_amount_cents' AS total
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(flag[0]?.resolved).toBeNull();
    expect(Number(flag[0]?.total)).toBe(9000);
  });
});

describe("#527 admin wallet adjustments need a key, and a key means one adjustment", () => {
  it("refuses a missing key and a reused key with a different amount", async () => {
    const missing = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'no key', NULL)",
      [IDS.customer],
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/WALLET_IDEMPOTENCY_KEY_REQUIRED/);

    const key = randomUUID();
    const first = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'k', NULL, $2) AS id",
      [IDS.customer, key],
    );
    const retry = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 5, 'k', NULL, $2) AS id",
      [IDS.customer, key],
    );
    expect(retry.rows?.[0]?.id).toBe(first.rows?.[0]?.id);

    const conflict = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', 7, 'k', NULL, $2) AS id",
      [IDS.customer, key],
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toMatch(/WALLET_IDEMPOTENCY_CONFLICT/);
  });
});

describe("#522 age and minor helpers are internal", () => {
  it("are not executable by signed-in or signed-out users", async () => {
    const rows = await queryRows<{ sig: string; auth: boolean; anon: boolean }>(
      db,
      `SELECT p.oid::regprocedure::text AS sig,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('booking_online_age_years', 'family_member_is_minor', 'booking_paymob_money_flag_open')`,
    );
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.auth, r.sig).toBe(false);
      expect(r.anon, r.sig).toBe(false);
    }
  });
});

describe("#523 UGC reports: no self-report, daily cap", () => {
  it("refuses reporting your own message and caps reports per day", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "pending" });
    await setBookingStatusAsSystem(db, bookingId, "confirmed");
    const conv = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.conversations WHERE booking_id = $1",
      [bookingId],
    );
    const conversationId = conv[0]!.id;
    const sent = await tryAsUser(
      db,
      IDS.customer,
      "INSERT INTO public.messages (conversation_id, body) VALUES ($1, 'hi') RETURNING id",
      [conversationId],
    );
    const messageId = String(sent.rows?.[0]?.id);

    const own = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.report_ugc('chat_message', 'spam', NULL, $1, $2, NULL)",
      [messageId, conversationId],
    );
    expect(own.ok).toBe(false);
    expect(own.error).toMatch(/UGC_REPORT_OWN_MESSAGE/);

    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.ugc_reports (subject_type, reason, conversation_id, booking_id, reported_by, reporter_role, status)
         SELECT 'chat_thread', 'spam', $1, $2, $3, 'provider', 'dismissed'
         FROM generate_series(1, 10)`,
        [conversationId, bookingId, IDS.providerUser],
      ),
    );
    const capped = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.report_ugc('chat_message', 'spam', NULL, $1, $2, NULL)",
      [messageId, conversationId],
    );
    expect(capped.ok).toBe(false);
    expect(capped.error).toMatch(/UGC_REPORT_LIMIT/);
  });
});

describe("#524 parent sees the tutor's name", () => {
  it("joins the tutor through providers.profile_id", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await makeOnline(bookingId, "2027-02-01T10:00:00+00");
    await asServiceRole(db, () =>
      db.query("UPDATE public.profiles SET full_name = 'Tutor Name' WHERE id = $1", [
        IDS.providerUser,
      ]),
    );
    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.student_parent_links
           (student_id, parent_id, requested_parent_phone, parent_email, status, decided_at)
         VALUES ($1, $2, '+201000000999', 'parent@example.test', 'linked', now())`,
        [IDS.customer, IDS.otherProviderUser],
      ),
    );
    const lessons = await tryAsUser(
      db,
      IDS.otherProviderUser,
      "SELECT booking_id::text, tutor_name FROM public.parent_student_lessons($1)",
      [IDS.customer],
    );
    expect(lessons.error).toBeUndefined();
    const row = lessons.rows?.find((r) => r.booking_id === bookingId);
    expect(row?.tutor_name).toBe("Tutor Name");
  });
});
