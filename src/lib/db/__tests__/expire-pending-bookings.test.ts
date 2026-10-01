import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  createExpiryDb,
  functionExecuteAllowed,
  IDS,
  insertPendingBooking,
  queryRows,
  readMigration,
  EXPIRY_MIGRATION,
  runSqlExpectError,
} from "./expire-pending-bookings.harness";

function hoursAgoIso(hours: number, now = Date.now()): string {
  return new Date(now - hours * 3600000).toISOString();
}

function hoursFromNowIso(hours: number, now = Date.now()): string {
  return new Date(now + hours * 3600000).toISOString();
}

describe("expire pending bookings", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("keeps tg_validate_booking_service out of the expiry migration", () => {
    const sql = readMigration(EXPIRY_MIGRATION);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.tg_validate_booking_service\s*\(/i);
    expect(sql).toContain("expire_pending_bookings");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("SKIP LOCKED");
    expect(sql).toContain("famy-expire-pending-bookings");
    expect(sql).toContain("*/5 * * * *");
  });

  it("expires a pending booking at the 12h TTL", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(12.1),
      startAt: hoursFromNowIso(48),
    });

    const expired = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(expired[0]?.expire_pending_bookings).toBe(1);

    const rows = await queryRows<{ status: string; cancellation_reason: string | null }>(
      db,
      `SELECT status::text AS status, cancellation_reason FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.cancellation_reason).toBe("provider_no_response");
  });

  it("expires a pending booking at the 2h-before-start boundary", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(1),
      startAt: hoursFromNowIso(1.9),
    });

    const expired = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(expired[0]?.expire_pending_bookings).toBe(1);

    const rows = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe("cancelled");
  });

  it("leaves a pending booking that is not yet due untouched", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(1),
      startAt: hoursFromNowIso(24),
    });

    const expired = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(expired[0]?.expire_pending_bookings).toBe(0);

    const rows = await queryRows<{ status: string; cancellation_reason: string | null }>(
      db,
      `SELECT status::text AS status, cancellation_reason FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.cancellation_reason).toBeNull();
  });

  it("does not touch an already confirmed booking", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(1),
      status: "confirmed",
    });

    const expired = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(expired[0]?.expire_pending_bookings).toBe(0);

    const rows = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe("confirmed");
  });

  it("is idempotent on a second run", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(48),
    });

    const first = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    const second = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(first[0]?.expire_pending_bookings).toBe(1);
    expect(second[0]?.expire_pending_bookings).toBe(0);

    const history = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.booking_status_history WHERE booking_id = $1 AND to_status = 'cancelled'`,
      [bookingId],
    );
    expect(history[0]?.n).toBe(1);
  });

  it("releases the slot so it can be booked again after expiry", async () => {
    db = await createExpiryDb();
    const startAt = hoursFromNowIso(48);
    const endAt = hoursFromNowIso(50);
    await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt,
      endAt,
    });

    await db.query(`SELECT public.expire_pending_bookings()`);

    const again = await db.query<{ id: string }>(
      `
        INSERT INTO public.bookings (
          customer_id, provider_id, service_id, address_id, start_at, end_at, status, created_at
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, 'pending', now())
        RETURNING id
      `,
      [IDS.customer, IDS.provider, IDS.service, IDS.address, startAt, endAt],
    );
    expect(again.rows[0]?.id).toBeTruthy();
  });

  it("creates in-app notifications for the customer and the provider", async () => {
    db = await createExpiryDb();
    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(48),
    });

    await db.query(`SELECT public.expire_pending_bookings()`);

    const notes = await queryRows<{ user_id: string; type: string; body_ar: string | null }>(
      db,
      `SELECT user_id::text AS user_id, type, body_ar FROM public.notifications WHERE booking_id = $1 ORDER BY user_id`,
      [bookingId],
    );
    expect(notes).toEqual([
      {
        user_id: IDS.customer,
        type: "booking_expired",
        body_ar: "مقدم الخدمة لم يرد في الوقت المحدد",
      },
      {
        user_id: IDS.providerUser,
        type: "booking_expired",
        body_ar: "لم ترد في الوقت المحدد. تم إلغاء الطلب.",
      },
    ]);

    const audit = await queryRows<{ action: string; reason: string | null }>(
      db,
      `SELECT action, reason FROM public.audit_logs WHERE booking_id = $1 AND action = 'expire_pending'`,
      [bookingId],
    );
    expect(audit[0]?.reason).toBe("provider_no_response");
  });

  it("does not capture a pending payment and flags an already-captured payment for admin review without refunding", async () => {
    db = await createExpiryDb();
    const pendingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(48),
    });
    const capturedId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(49),
    });

    await db.query(
      `INSERT INTO public.payments (booking_id, customer_id, status, amount) VALUES ($1, $2, 'pending', 100)`,
      [pendingId, IDS.customer],
    );
    await db.query(
      `INSERT INTO public.payments (booking_id, customer_id, status, amount) VALUES ($1, $2, 'captured', 200)`,
      [capturedId, IDS.customer],
    );

    await db.query(`SELECT public.expire_pending_bookings()`);

    const pendingPay = await queryRows<{ status: string; needs_admin_review: boolean }>(
      db,
      `SELECT status::text AS status, needs_admin_review FROM public.payments WHERE booking_id = $1`,
      [pendingId],
    );
    expect(pendingPay[0]?.status).toBe("pending");
    expect(pendingPay[0]?.needs_admin_review).toBe(false);

    const capturedPay = await queryRows<{
      status: string;
      needs_admin_review: boolean;
      metadata: { admin_review_reason?: string };
    }>(
      db,
      `SELECT status::text AS status, needs_admin_review, metadata FROM public.payments WHERE booking_id = $1`,
      [capturedId],
    );
    expect(capturedPay[0]?.status).toBe("captured");
    expect(capturedPay[0]?.needs_admin_review).toBe(true);
    expect(capturedPay[0]?.metadata.admin_review_reason).toBe("expired_pending_captured");
  });

  it("denies EXECUTE on expire_pending_bookings to authenticated and anon", async () => {
    db = await createExpiryDb();
    expect(await functionExecuteAllowed(db, "service_role")).toBe(true);
    expect(await functionExecuteAllowed(db, "authenticated")).toBe(false);
    expect(await functionExecuteAllowed(db, "anon")).toBe(false);
  });

  it("rejects create_booking when start_at is inside the min-hours-before-start window", async () => {
    db = await createExpiryDb();
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [IDS.customer]);

    await runSqlExpectError(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          now() + interval '1 hour', now() + interval '3 hours',
          gen_random_uuid(), NULL, NULL, NULL, '[]'::jsonb
        )
      `,
      [IDS.provider, IDS.service, IDS.address],
      /BOOKING_INVALID_BOOKING_REQUEST/,
    );
  });

  it("uses the stricter of min_hours_before_start and provider min_notice_hours", async () => {
    db = await createExpiryDb();
    await db.query(`UPDATE public.providers SET min_notice_hours = 4 WHERE id = $1`, [
      IDS.provider,
    ]);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [IDS.customer]);

    await runSqlExpectError(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          now() + interval '3 hours', now() + interval '5 hours',
          gen_random_uuid(), NULL, NULL, NULL, '[]'::jsonb
        )
      `,
      [IDS.provider, IDS.service, IDS.address],
      /BOOKING_INVALID_BOOKING_REQUEST/,
    );

    const created = await queryRows<{ create_booking: { booking_id: string; created: boolean } }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          now() + interval '5 hours', now() + interval '7 hours',
          gen_random_uuid(), NULL, NULL, NULL, '[]'::jsonb
        ) AS create_booking
      `,
      [IDS.provider, IDS.service, IDS.address],
    );
    expect(created[0]?.create_booking.created).toBe(true);
  });

  it("replays an existing booking when a retry is now inside the creation window", async () => {
    db = await createExpiryDb();
    await db.query(`UPDATE public.providers SET min_notice_hours = 0 WHERE id = $1`, [
      IDS.provider,
    ]);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [IDS.customer]);
    const key = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const startAt = hoursFromNowIso(5);
    const endAt = hoursFromNowIso(7);

    const first = await queryRows<{ create_booking: { booking_id: string; created: boolean } }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          $4::timestamptz, $5::timestamptz,
          $6::uuid, NULL, NULL, NULL, '[]'::jsonb
        ) AS create_booking
      `,
      [IDS.provider, IDS.service, IDS.address, startAt, endAt, key],
    );
    expect(first[0]?.create_booking.created).toBe(true);

    await db.query(
      `UPDATE public.settings SET value = '{"pending_ttl_hours": 12, "min_hours_before_start": 24}'::jsonb WHERE key = 'booking_expiry'`,
    );

    const retry = await queryRows<{
      create_booking: { booking_id: string; created: boolean; idempotent_replay: boolean };
    }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          $4::timestamptz, $5::timestamptz,
          $6::uuid, NULL, NULL, NULL, '[]'::jsonb
        ) AS create_booking
      `,
      [IDS.provider, IDS.service, IDS.address, startAt, endAt, key],
    );
    expect(retry[0]?.create_booking.created).toBe(false);
    expect(retry[0]?.create_booking.idempotent_replay).toBe(true);
    expect(retry[0]?.create_booking.booking_id).toBe(first[0]?.create_booking.booking_id);
  });

  it("falls back to 12/2 when booking_expiry values are not JSON numbers", async () => {
    db = await createExpiryDb();
    await db.query(
      `UPDATE public.settings SET value = '{"pending_ttl_hours":"nope","min_hours_before_start":true}'::jsonb WHERE key = 'booking_expiry'`,
    );

    const settings = await queryRows<{ pending_ttl_hours: number; min_hours_before_start: number }>(
      db,
      `SELECT pending_ttl_hours, min_hours_before_start FROM public.booking_expiry_settings()`,
    );
    expect(Number(settings[0]?.pending_ttl_hours)).toBe(12);
    expect(Number(settings[0]?.min_hours_before_start)).toBe(2);

    const bookingId = await insertPendingBooking(db, {
      createdAt: hoursAgoIso(13),
      startAt: hoursFromNowIso(48),
    });
    const expired = await queryRows<{ expire_pending_bookings: number }>(
      db,
      `SELECT public.expire_pending_bookings()`,
    );
    expect(expired[0]?.expire_pending_bookings).toBe(1);
    const rows = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(rows[0]?.status).toBe("cancelled");
  });
});
