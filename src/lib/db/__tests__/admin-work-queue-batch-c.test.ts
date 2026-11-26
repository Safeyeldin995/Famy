import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  asUser,
  createProviderLifecycleDb,
  IDS,
  queryRows,
  seedDraftProvider,
  tryAsUser,
} from "./provider-lifecycle.harness";
import { cairoDatePlusDays, stableCairoBookingBaseDate } from "./cairo-stable-booking-date";

let db: PGlite;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("BEGIN");
  bookingSlotOffset = 14;
  await seedDraftProvider(db);
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

let bookingSlotOffset = 14;

async function insertBooking(status: string): Promise<string> {
  const slotOffsetDays = bookingSlotOffset++;
  const service = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = 'hourly-babysitting' LIMIT 1`,
  );
  const serviceId = service[0]!.id;

  await asServiceRole(db, async () => {
    await queryRows(
      db,
      `INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code) VALUES
        ($1, 'toddler'), ($1, 'preschool'), ($1, 'school_age')
       ON CONFLICT DO NOTHING`,
      [IDS.provider],
    );
    await queryRows(
      db,
      `UPDATE public.providers SET max_children_per_booking = 3, is_verified = true, is_active = true
       WHERE id = $1`,
      [IDS.provider],
    );
  });

  await asUser(db, IDS.adminUser, async () => {
    await queryRows(
      db,
      `UPDATE public.provider_services SET status = 'approved' WHERE provider_id = $1 AND service_id = $2`,
      [IDS.provider, serviceId],
    );
  });

  await asServiceRole(db, async () => {
    await queryRows(db, `SELECT set_config('app.onboarding_status_transition', '1', true)`);
    await queryRows(
      db,
      `UPDATE public.providers SET onboarding_status = 'APPROVED' WHERE id = $1`,
      [IDS.provider],
    );
  });

  const slotDate = cairoDatePlusDays(stableCairoBookingBaseDate(), slotOffsetDays);
  const created = await asUser(db, IDS.customer, async () =>
    queryRows<{ result: { booking_id: string } }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          ($5::date + time '10:00') AT TIME ZONE 'Africa/Cairo',
          ($5::date + time '12:00') AT TIME ZONE 'Africa/Cairo',
          gen_random_uuid(),
          $4::uuid,
          NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL,
          'adult_present'
        ) AS result
      `,
      [IDS.provider, serviceId, IDS.addressInZone, IDS.childMember, slotDate],
    ),
  );
  const bookingId = created[0]!.result.booking_id;

  if (status !== "pending") {
    await asServiceRole(db, async () => {
      await queryRows(db, `UPDATE public.bookings SET status = $2::public.booking_status WHERE id = $1`, [
        bookingId,
        status,
      ]);
    });
  }

  return bookingId;
}

async function queueCount(queue: string): Promise<number> {
  const result = await tryAsUser(
    db,
    IDS.adminUser,
    `SELECT item_count::int AS n FROM public.admin_work_queue_counts() WHERE queue = $1`,
    [queue],
  );
  expect(result.ok, queue).toBe(true);
  return (result.rows as { n: number }[])[0]?.n ?? 0;
}

describe("admin work queue batch C (20261126220000)", () => {
  it("matches open_cases to open disputes, tickets, and no-show reports", async () => {
    const ticketBooking = await insertBooking("confirmed");
    const disputeBooking = await insertBooking("confirmed");
    const noShowBooking = await insertBooking("no_show");
    await asServiceRole(db, async () => {
      await queryRows(
        db,
        `INSERT INTO public.support_tickets (
           user_id, subject, status, booking_id,
           opened_by_role, category, description
         ) VALUES ($1, 'help', 'open', $2, 'customer', 'other', 'details')`,
        [IDS.customer, ticketBooking],
      );
      await queryRows(
        db,
        `INSERT INTO public.disputes (
          booking_id, opened_by, opened_by_role, previous_status,
          reason, description, status
        ) VALUES ($1, $2, 'customer', 'confirmed', 'reason', 'details', 'open')`,
        [disputeBooking, IDS.customer],
      );
      await queryRows(
        db,
        `INSERT INTO public.no_show_reports (
          booking_id, reported_by, reporter_role, reported_party,
          previous_status, reason, status
        ) VALUES ($1, $2, 'customer', 'provider', 'confirmed', 'reason', 'open')`,
        [noShowBooking, IDS.customer],
      );
    });

    const listCount = await asServiceRole(db, async () => {
      const rows = await queryRows<{ n: number }>(
        db,
        `
        SELECT (
          (SELECT count(*) FROM public.disputes WHERE status IN ('open', 'info_requested')) +
          (SELECT count(*) FROM public.support_tickets WHERE status IN ('open', 'pending')) +
          (SELECT count(*) FROM public.no_show_reports WHERE status IN ('open', 'info_requested'))
        )::int AS n
        `,
      );
      return rows[0]?.n ?? 0;
    });

    expect(await queueCount("open_cases")).toBe(listCount);
    expect(listCount).toBeGreaterThanOrEqual(3);
  });

  it("counts disputed bookings separately from online session reviews", async () => {
    const disputedId = await insertBooking("disputed");
    const problemId = await insertBooking("no_show");
    const reviewBookingId = await insertBooking("confirmed");

    await asServiceRole(db, async () => {
      await queryRows(
        db,
        `INSERT INTO public.online_session_admin_reviews (booking_id, reason, status)
         VALUES ($1, 'short session', 'open')`,
        [reviewBookingId],
      );
    });

    const bookingListCount = await asServiceRole(db, async () => {
      const rows = await queryRows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM public.bookings WHERE status IN ('disputed', 'no_show')`,
      );
      return rows[0]?.n ?? 0;
    });
    const reviewListCount = await asServiceRole(db, async () => {
      const rows = await queryRows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM public.online_session_admin_reviews WHERE status = 'open'`,
      );
      return rows[0]?.n ?? 0;
    });

    expect(await queueCount("bookings_needing_action")).toBe(bookingListCount);
    expect(await queueCount("online_session_reviews")).toBe(reviewListCount);
    expect(bookingListCount).toBeGreaterThanOrEqual(2);
    expect(reviewListCount).toBe(1);
    expect(disputedId).toBeTruthy();
    expect(problemId).toBeTruthy();
  });
});