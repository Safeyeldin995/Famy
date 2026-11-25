import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;

async function seedOnlineBookingPastEnd(): Promise<string> {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  await db.exec(`
    ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
    UPDATE public.bookings
    SET service_mode = 'online',
        start_at = now() - interval '3 hours',
        end_at = now() - interval '2 hours',
        online_session_outcome = NULL
    WHERE id = '${bookingId}';
    ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
  `);
  return bookingId;
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
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status`,
      [paymentId],
    );
    expect(attempt.ok).toBe(false);
    expect(attempt.error).toMatch(/Payment update not authorized|cannot be captured|admin review/i);
  });
});
