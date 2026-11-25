import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { readMigration } from "./push-notifications.harness";
import { applySql } from "./monitoring-privilege-harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await applySql(db, readMigration("20261125133000_launch_gaps_notifications.sql"));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("launch gaps notifications", () => {
  it("notifies customer and provider when a payment is captured", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);

    await asServiceRole(db, () =>
      db.exec(`
        SELECT set_config('app.ledger_internal_capture', 'on', true);
        UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
        SELECT set_config('app.ledger_internal_capture', 'off', true);
      `),
    );

    const rows = await queryRows<{ type: string; user_id: string }>(
      db,
      `SELECT type, user_id::text FROM public.notifications
       WHERE booking_id = $1 AND type = 'payment_received'
       ORDER BY user_id`,
      [bookingId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.user_id).sort()).toEqual(
      [IDS.customer, IDS.providerUser].sort(),
    );
  });

  it("notifies customer when InstaPay receipt is rejected", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const methods = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.payment_methods WHERE code = 'instapay' LIMIT 1`,
    );
    const methodId = methods[0]?.id;
    expect(methodId).toBeTruthy();
    const due = await queryRows<{ amount: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS amount FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const amount = due[0]?.amount ?? "200";
    const inserted = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.payments (
        booking_id, customer_id, amount, status, payment_method_type, payment_method_code,
        payment_method_id, rejection_reason
      ) VALUES ($1, $2, $3::numeric, 'pending_review', 'manual_transfer', 'instapay', $4, NULL)
      RETURNING id`,
      [bookingId, IDS.customer, amount, methodId],
    );
    const paymentId = inserted[0]!.id;

    const reject = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.payments
       SET status = 'rejected', rejection_reason = 'Receipt unreadable'
       WHERE id = $1`,
      [paymentId],
    );
    expect(reject.error).toBeUndefined();

    const notif = await queryRows<{ type: string; body_en: string }>(
      db,
      `SELECT type, body_en FROM public.notifications WHERE booking_id = $1 AND type = 'instapay_receipt_rejected'`,
      [bookingId],
    );
    expect(notif).toHaveLength(1);
    expect(notif[0]?.body_en).toContain("Receipt unreadable");
  });

  it("wallet credit trigger emits wallet_credited once", async () => {
    const { bookingId } = await paidConfirmedBooking();

    const reasons = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency' LIMIT 1`,
    );
    const reasonId = reasons[0]?.id;
    expect(reasonId).toBeTruthy();

    const first = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.cancel_booking($1, $2, NULL)`,
      [bookingId, reasonId],
    );
    expect(first.error).toBeUndefined();

    const notes = await queryRows<{ type: string; count: string }>(
      db,
      `SELECT type, count(*)::text AS count FROM public.notifications
       WHERE booking_id = $1 AND type = 'wallet_credited'
       GROUP BY type`,
      [bookingId],
    );
    expect(notes[0]?.count).toBe("1");
  });

  it("process_due_reminders uses booking deep links for in-person confirmed bookings", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET start_at = now() + interval '2 hours',
            end_at = now() + interval '3 hours'
        WHERE id = '${bookingId}';
      `),
    );

    const rule = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.booking_reminder_rules (lead_minutes, is_active)
       VALUES (60, true) RETURNING id`,
    );

    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.booking_reminders (
          booking_id, rule_id, recipient_user_id, scheduled_for, status
        ) VALUES ($1, $2, $3, now() - interval '1 minute', 'pending')`,
        [bookingId, rule[0]!.id, IDS.customer],
      ),
    );

    await asServiceRole(db, () => db.query(`SELECT public.process_due_reminders()`));

    const deep = await queryRows<{ deep_link: string; type: string }>(
      db,
      `SELECT deep_link, type FROM public.notifications
       WHERE booking_id = $1 AND type = 'booking_reminder'`,
      [bookingId],
    );
    expect(deep[0]?.deep_link).toBe(`/booking/${bookingId}`);
  });
});

async function paidConfirmedBooking() {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
    `),
  );
  return { bookingId, paymobId };
}