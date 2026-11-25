import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  cancellationReasonFor,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** A confirmed online booking whose card payment is captured (money held). */
async function paidConfirmedOnline() {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  // Fixture only: turn the seeded booking into an online lesson (the guard trigger
  // forbids changing service_mode after creation, so triggers are skipped here).
  await db.exec("SET session_replication_role = replica");
  try {
    await db.query(`UPDATE public.bookings SET service_mode = 'online' WHERE id = $1`, [bookingId]);
  } finally {
    await db.exec("SET session_replication_role = DEFAULT");
  }
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
    `),
  );
  return { bookingId, paymobId };
}

async function refundCredits(bookingId: string): Promise<number> {
  const rows = await queryRows<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM public.customer_wallet_entries
     WHERE booking_id = $1 AND reason::text = 'customer_cancelled_refund'`,
    [bookingId],
  );
  return Number(rows[0]?.n ?? 0);
}

describe("wallet internal RPC lockdown (#443, #444)", () => {
  it("signed-in users cannot call the internal wallet helpers", async () => {
    const { bookingId } = await paidConfirmedOnline();
    const credit = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.credit_customer_wallet_customer_cancelled($1::uuid)",
      [bookingId],
    );
    expect(credit.ok).toBe(false);
    expect(credit.error).toMatch(/permission denied/i);

    const restore = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.restore_customer_wallet_checkout_debit($1::uuid)",
      [bookingId],
    );
    expect(restore.ok).toBe(false);
    expect(restore.error).toMatch(/permission denied/i);
    expect(await refundCredits(bookingId)).toBe(0);
  });

  it("the credit helper ignores a booking that is still confirmed", async () => {
    const { bookingId } = await paidConfirmedOnline();
    const result = await queryRows<{ id: string | null }>(
      db,
      "SELECT public.credit_customer_wallet_customer_cancelled($1::uuid) AS id",
      [bookingId],
    );
    expect(result[0]?.id).toBeNull();
    expect(await refundCredits(bookingId)).toBe(0);
  });

  it("a customer cancelling a paid online lesson is still credited through cancel_booking", async () => {
    const { bookingId } = await paidConfirmedOnline();
    const reasonId = await cancellationReasonFor(db, "customer", ["confirmed"]);
    const cancel = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.cancel_booking($1::uuid, $2::uuid, 'test')",
      [bookingId, reasonId],
    );
    expect(cancel.error).toBeUndefined();
    expect(await refundCredits(bookingId)).toBe(1);
  });
});
