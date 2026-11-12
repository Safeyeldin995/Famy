import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  allowCompletionForBooking,
  asServiceRole,
  asUser,
  bookingStatus,
  createBookingLifecycleDb,
  expectRejected,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
  updateBookingStatus,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function allowAutoCompleteEligibility(db: PGlite): Promise<void> {
  await asServiceRole(db, () =>
    db.exec(`
      UPDATE public.settings
      SET value = COALESCE(value, '{}'::jsonb)
        || jsonb_build_object('completion_auto_from', '2020-01-01T00:00:00Z'::text)
      WHERE key = 'booking_expiry';
    `),
  );
}

async function reachCompletionRequested(db: PGlite, bookingId: string): Promise<void> {
  await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
  await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
  await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");
  await updateBookingStatus(db, IDS.customer, bookingId, "in_progress");
  await allowCompletionForBooking(db, bookingId);
  await updateBookingStatus(db, IDS.providerUser, bookingId, "completion_requested");
}

describe("auto_complete_bookings", () => {
  it("completes after N hours for rows after the cutoff", async () => {
    await allowAutoCompleteEligibility(db);
    const { bookingId } = await seedLifecycleBooking(db);
    await reachCompletionRequested(db, bookingId);
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = now() - interval '7 hours'
        WHERE id = '${bookingId}';
      `),
    );
    const n = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.auto_complete_bookings()::int AS n`),
    );
    expect(n[0]?.n).toBe(1);
    expect(await bookingStatus(db, bookingId)).toBe("completed");
  });

  it("does not complete before N hours", async () => {
    await allowAutoCompleteEligibility(db);
    const { bookingId } = await seedLifecycleBooking(db);
    await reachCompletionRequested(db, bookingId);
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = now() - interval '2 hours'
        WHERE id = '${bookingId}';
      `),
    );
    const n = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.auto_complete_bookings()::int AS n`),
    );
    expect(n[0]?.n).toBe(0);
    expect(await bookingStatus(db, bookingId)).toBe("completion_requested");
  });

  it("does not touch disputed bookings", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.open_booking_dispute(
         $1::uuid, 'issue', 'Quality problem during travel.', '{}'::text[]
       )`,
      [bookingId],
    );
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = now() - interval '7 hours'
        WHERE id = '${bookingId}';
      `),
    );
    const n = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.auto_complete_bookings()::int AS n`),
    );
    expect(n[0]?.n).toBe(0);
    expect(await bookingStatus(db, bookingId)).toBe("disputed");
  });

  it("does not complete rows before completion_auto_from", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await reachCompletionRequested(db, bookingId);
    const cutoff = await queryRows<{ cutoff: string }>(
      db,
      `SELECT completion_auto_from::text AS cutoff FROM public.booking_expiry_settings()`,
    );
    const from = cutoff[0]?.cutoff;
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = timestamptz '${from}' - interval '1 day'
        WHERE id = '${bookingId}';
      `),
    );
    const n = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.auto_complete_bookings()::int AS n`),
    );
    expect(n[0]?.n).toBe(0);
  });

  it("leaves pricing unchanged", async () => {
    await allowAutoCompleteEligibility(db);
    const { bookingId } = await seedLifecycleBooking(db);
    const before = await queryRows<{ price_total: string }>(
      db,
      `SELECT price_total::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    await reachCompletionRequested(db, bookingId);
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = now() - interval '7 hours'
        WHERE id = '${bookingId}';
      `),
    );
    await asServiceRole(db, () => db.query(`SELECT public.auto_complete_bookings()`));
    const after = await queryRows<{ price_total: string }>(
      db,
      `SELECT price_total::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(after[0]?.price_total).toBe(before[0]?.price_total);
  });

  it("is not callable by authenticated users", async () => {
    expectRejected(
      await tryAsUser(db, IDS.customer, `SELECT public.auto_complete_bookings()::int AS n`),
      /permission|42501/i,
      "customer auto_complete",
    );
    expectRejected(
      await tryAsAnon(db, `SELECT public.auto_complete_bookings()::int AS n`),
      /permission|42501/i,
      "anon auto_complete",
    );
  });
});

async function tryAsAnon(db: PGlite, sql: string): Promise<{ ok: boolean; error?: string }> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE anon");
    await db.query(sql);
    await db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
