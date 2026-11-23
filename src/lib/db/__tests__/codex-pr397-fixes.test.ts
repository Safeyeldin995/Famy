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
import { randomUUID } from "node:crypto";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Codex PR #397 database fixes", () => {
  it("rejects online create_booking for learners under 12", async () => {
    const service = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1",
    );
    const result = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking(
        $1::uuid, $2::uuid, NULL,
        now() + interval '3 days', now() + interval '3 days' + interval '2 hours',
        $3::uuid, $4::uuid, NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, 'online'
      )`,
      [IDS.provider, service[0]!.id, randomUUID(), IDS.childMember],
    );
    expect(result.error).toMatch(/BOOKING_ONLINE_AGE_MINIMUM/);
  });

  it("blocks direct lesson-issue inserts and exposes party-safe view", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });

    const direct = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.online_lesson_issue_reports (
        booking_id, reported_by, reporter_role, category, description, status, priority
      ) VALUES ($1, $2, 'customer', 'connection', 'Direct insert bypass attempt', 'open', 'high')`,
      [bookingId, IDS.customer],
    );
    expect(direct.error).toBeDefined();

    await asServiceRole(db, () =>
      db.query(
        `INSERT INTO public.online_lesson_issue_reports (
           booking_id, reported_by, reporter_role, category, description, admin_notes
         ) VALUES ($1, $2, 'customer', 'connection', 'Harness seed open report', 'internal-only')`,
        [bookingId, IDS.customer],
      ),
    );

    const table = await tryAsUser(
      db,
      IDS.customer,
      `SELECT admin_notes FROM public.online_lesson_issue_reports WHERE booking_id = $1`,
      [bookingId],
    );
    expect(table.rows?.length ?? 0).toBe(0);

    const viaView = await tryAsUser(
      db,
      IDS.customer,
      `SELECT * FROM public.online_lesson_issue_reports_party WHERE booking_id = $1`,
      [bookingId],
    );
    expect(viaView.error).toBeUndefined();
    expect((viaView.rows?.[0] as { admin_notes?: string } | undefined)?.admin_notes).toBeUndefined();
  });

  it("captures wallet-only checkout and settles provider-cancel refunds", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const amount = await queryRows<{ a: string }>(
      db,
      "SELECT amount::text AS a FROM public.payments WHERE id = $1",
      [paymobId],
    );
    const total = Number(amount[0]!.a);

    await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_adjust_customer_wallet($1, 'credit', $2, $3, NULL)",
      [IDS.customer, total, "checkout test credit"],
    );

    const checkout = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.apply_customer_wallet_to_booking_payment($1) AS result",
      [paymobId],
    );
    expect(checkout.error).toBeUndefined();
    const payload = checkout.rows?.[0]?.result as { captured?: boolean } | undefined;
    expect(payload?.captured).toBe(true);

    const status = await queryRows<{ s: string }>(
      db,
      "SELECT status::text AS s FROM public.payments WHERE id = $1",
      [paymobId],
    );
    expect(status[0]?.s).toBe("captured");

    const paid = await paidConfirmedForWalletRefund();
    const cancel = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.cancel_booking($1, (SELECT id FROM public.cancellation_reasons WHERE code = 'provider_emergency' LIMIT 1), NULL)",
      [paid.bookingId],
    );
    expect(cancel.error).toBeUndefined();

    const pay = await queryRows<{ s: string; settled: string }>(
      db,
      `SELECT status::text AS s, metadata->>'wallet_refund_settled' AS settled
       FROM public.payments WHERE id = $1`,
      [paid.paymobId],
    );
    expect(pay[0]?.s).toBe("refunded");
    expect(pay[0]?.settled).toBe("true");
  });

  it("commits livekit webhook dedupe with attendance in one RPC", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const eventId = randomUUID();

    await asServiceRole(db, () =>
      db.query("SELECT public.apply_livekit_session_webhook($1, $2, $3, $4, now())", [
        eventId,
        bookingId,
        "participant_joined",
        "customer",
      ]),
    );

    const events = await queryRows<{ count: string }>(
      db,
      "SELECT count(*)::text AS count FROM public.session_events WHERE booking_id = $1",
      [bookingId],
    );
    expect(events[0]?.count).toBe("1");

    await asServiceRole(db, () =>
      db.query("SELECT public.apply_livekit_session_webhook($1, $2, $3, $4, now())", [
        eventId,
        bookingId,
        "participant_joined",
        "customer",
      ]),
    );
    const again = await queryRows<{ count: string }>(
      db,
      "SELECT count(*)::text AS count FROM public.session_events WHERE booking_id = $1",
      [bookingId],
    );
    expect(again[0]?.count).toBe("1");
  });
});

async function paidConfirmedForWalletRefund() {
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