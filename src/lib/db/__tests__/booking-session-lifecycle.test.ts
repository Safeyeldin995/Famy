import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  allowCompletionForBooking,
  asServiceRole,
  asUser,
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

describe("booking session lifecycle (issue scenarios)", () => {
  it("1) happy path sets session timestamps on each step", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");
    const started = await updateBookingStatus(db, IDS.customer, bookingId, "in_progress");
    expect(started.ok, started.error).toBe(true);

    const mid = await queryRows<{
      arrival_confirmed_at: string | null;
      session_started_at: string | null;
    }>(
      db,
      `SELECT arrival_confirmed_at::text, session_started_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(mid[0]?.arrival_confirmed_at).toBeTruthy();
    expect(mid[0]?.session_started_at).toBeTruthy();

    await allowCompletionForBooking(db, bookingId);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "completion_requested");
    const afterReq = await queryRows<{ session_ended_at: string | null }>(
      db,
      `SELECT session_ended_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(afterReq[0]?.session_ended_at).toBeTruthy();
  });

  it("2) PO case: provider cannot mark on_the_way after slot ended; admin can advance", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET start_at = now() - interval '26 hours',
            end_at = now() - interval '24 hours',
            status = 'confirmed'::public.booking_status
        WHERE id = '${bookingId}';
      `),
    );
    const blocked = await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    expectRejected(blocked, /ميعاد الجلسة|23514/i, "late on_the_way");

    const ids = await asUser(db, IDS.adminUser, () =>
      queryRows<{ booking_id: string }>(
        db,
        `SELECT t::text AS booking_id FROM public.admin_bookings_needing_lifecycle_attention() AS t`,
      ),
    );
    expect(ids.some((r) => r.booking_id === bookingId)).toBe(true);

    const adminMove = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_set_booking_status($1::uuid, 'cancelled'::public.booking_status, $2)`,
      [bookingId, "admin resolved stale confirmed slot"],
    );
    expect(adminMove.ok, adminMove.error).toBe(true);
  });

  it("3) early finish rejected before duration, allowed after", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");
    await updateBookingStatus(db, IDS.customer, bookingId, "in_progress");

    const early = await updateBookingStatus(db, IDS.providerUser, bookingId, "completion_requested");
    expectRejected(early, /دقيقة|23514/i, "early completion");

    await allowCompletionForBooking(db, bookingId);
    const ok = await updateBookingStatus(db, IDS.providerUser, bookingId, "completion_requested");
    expect(ok.ok, ok.error).toBe(true);
  });

  it("4) stuck completion_requested appears in attention; admin completes", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");
    await updateBookingStatus(db, IDS.customer, bookingId, "in_progress");
    await allowCompletionForBooking(db, bookingId);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "completion_requested");
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET completion_requested_at = now() - interval '13 hours'
        WHERE id = '${bookingId}';
      `),
    );
    const ids = await asUser(db, IDS.adminUser, () =>
      queryRows<{ booking_id: string }>(
        db,
        `SELECT t::text AS booking_id FROM public.admin_bookings_needing_lifecycle_attention() AS t`,
      ),
    );
    expect(ids.some((r) => r.booking_id === bookingId)).toBe(true);
    const done = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_set_booking_status($1::uuid, 'completed'::public.booking_status, $2)`,
      [bookingId, "customer did not confirm completion"],
    );
    expect(done.ok, done.error).toBe(true);
  });

  it("5) admin advances booking when customer never confirms arrival", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");

    const admin = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_set_booking_status($1::uuid, 'in_progress'::public.booking_status, $2)`,
      [bookingId, "customer unreachable"],
    );
    expect(admin.ok, admin.error).toBe(true);
  });

  it("6) non-admin cannot call admin RPCs or write session columns", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    expectRejected(
      await tryAsUser(
        db,
        IDS.customer,
        `SELECT public.admin_set_booking_status($1::uuid, 'in_progress'::public.booking_status, 'x')`,
        [bookingId],
      ),
      /Admin authorization|42501/i,
      "customer admin_set_booking_status",
    );
    const tamper = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.bookings SET session_started_at = now() WHERE id = $1 RETURNING session_started_at::text AS session_started_at`,
      [bookingId],
    );
    const stored = await queryRows<{ session_started_at: string | null }>(
      db,
      `SELECT session_started_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    if (tamper.ok) {
      expect(stored[0]?.session_started_at).toBeFalsy();
    } else {
      expect(tamper.error ?? "").toMatch(/Session timestamps cannot|42501|permission/i);
    }
  });

  it("7) dispute flow still works after lifecycle changes", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    const dispute = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.open_booking_dispute(
         $1::uuid, 'quality', 'Service issue during travel.', '{}'::text[]
       ) AS id`,
      [bookingId],
    );
    expect(dispute.ok, dispute.error).toBe(true);
  });

  it("8) pricing columns unchanged after admin status change", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    const before = await queryRows<{ price_total: string; promo_code: string | null }>(
      db,
      `SELECT price_total::text, promo_code FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_set_booking_status($1::uuid, 'confirmed'::public.booking_status, $2)`,
      [bookingId, "noop advance"],
    );
    const after = await queryRows<{ price_total: string; promo_code: string | null }>(
      db,
      `SELECT price_total::text, promo_code FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(after[0]?.price_total).toBe(before[0]?.price_total);
    expect(after[0]?.promo_code).toBe(before[0]?.promo_code);
  });
});
