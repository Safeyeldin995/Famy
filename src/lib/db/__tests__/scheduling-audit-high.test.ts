import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asUser,
  createBookingLifecycleDb,
  lifecycleBookingBaseDate,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { cairoDatePlusDays } from "./cairo-stable-booking-date";

const OTHER_CUSTOMER = "00000000-0000-0000-0000-000000000002";

describe("scheduling audit HIGH fixes", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBookingLifecycleDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("provider_busy_ranges exposes overlaps without booking rows via RLS", async () => {
    await db.exec(`
      INSERT INTO auth.users (id, raw_user_meta_data) VALUES
        ('${OTHER_CUSTOMER}', '{"full_name":"Other Customer"}')
      ON CONFLICT (id) DO NOTHING;
      UPDATE public.profiles
      SET phone = '01099887766'
      WHERE id = '${OTHER_CUSTOMER}' AND coalesce(phone, '') = '';
    `);
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const booking = await queryRows<{ provider_id: string; start_at: string; end_at: string }>(
      db,
      `SELECT provider_id, start_at::text, end_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const row = booking[0]!;

    const foreignBusy = await asUser(db, OTHER_CUSTOMER, () =>
      queryRows<{ start_at: string; end_at: string }>(
        db,
        `SELECT start_at::text, end_at::text FROM public.provider_busy_ranges($1::uuid, $2::timestamptz, $3::timestamptz)`,
        [row.provider_id, row.start_at, row.end_at],
      ),
    );
    expect(foreignBusy.length).toBeGreaterThan(0);
    expect(foreignBusy[0]?.start_at).toBe(row.start_at);

    const foreignSelect = await tryAsUser(
      db,
      OTHER_CUSTOMER,
      `SELECT customer_id FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(foreignSelect.ok).toBe(true);
    expect(foreignSelect.rows?.length ?? 0).toBe(0);
  });

  it("rejects reschedule requests that change session length", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const rescheduleDate = cairoDatePlusDays(lifecycleBookingBaseDate(), 80);

    const bad = await tryAsUser(
      db,
      IDS.customer,
      `
        SELECT public.request_reschedule(
          $1::uuid,
          ($2::date + time '14:00') AT TIME ZONE 'Africa/Cairo',
          ($2::date + time '18:00') AT TIME ZONE 'Africa/Cairo',
          'longer session'
        ) AS request_id
      `,
      [bookingId, rescheduleDate],
    );
    expect(bad.ok).toBe(false);
    expect(String(bad.error ?? "")).toMatch(/same session length/i);

    const good = await tryAsUser(
      db,
      IDS.customer,
      `
        SELECT public.request_reschedule(
          $1::uuid,
          ($2::date + time '14:00') AT TIME ZONE 'Africa/Cairo',
          ($2::date + time '16:00') AT TIME ZONE 'Africa/Cairo',
          'same length'
        ) AS request_id
      `,
      [bookingId, rescheduleDate],
    );
    expect(good.ok, good.error).toBe(true);
  });
});