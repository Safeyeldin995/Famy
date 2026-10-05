import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  createDisposableDb,
  IDS,
  readMigration,
  seedIdentities,
} from "./babysitting-capabilities-harness";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

const MIGRATION = "20261005100000_fixed_price_babysitting_packages.sql";
const NIGHT = "00000000-0000-0000-0000-000000000999";
const LATEST_PRICING = "20261001130000_tutoring_teaching_capabilities.sql";
let db: PGlite;

beforeEach(async () => {
  db = await createDisposableDb();
  await seedIdentities(db);
  await applyBabysittingMigration(db);
  // Extend the existing disposable fixture with only the columns used by the
  // tracked slot and pricing functions. Fixed-package fixtures use a non-tutoring
  // category so unrelated child/capability policy is covered by its own suites.
  await db.exec(`
    ALTER TABLE public.services ADD slug text, ADD duration_min int DEFAULT 60,
      ADD description_en text, ADD description_ar text;
    ALTER TABLE public.providers ADD is_active boolean DEFAULT true,
      ADD vacation_mode boolean DEFAULT false, ADD min_notice_hours int DEFAULT 0,
      ADD max_advance_days int DEFAULT 365, ADD buffer_minutes int DEFAULT 0;
    ALTER TABLE public.bookings ADD price_commission_percent numeric,
      ADD price_commission_amount numeric, ADD price_provider_net numeric;
    CREATE TABLE public.availability_rules (provider_id uuid, weekday smallint, start_time time, end_time time);
    CREATE TABLE public.provider_vacations (provider_id uuid, start_date date, end_date date);
    CREATE TABLE public.availability_exceptions (provider_id uuid, date date, end_date date, start_time time, end_time time, is_blocked boolean);
    DROP FUNCTION public.check_booking_slot(uuid,timestamptz,timestamptz,uuid);
    UPDATE public.services SET slug = 'babysetting', minimum_price = 800, maximum_price = 2000 WHERE id = '${IDS.cleaningService}';
    INSERT INTO public.services (id, category_id, slug, minimum_price, maximum_price)
      VALUES ('${NIGHT}', '${IDS.cleaningCategory}', 'overnight-babysitting', 500, 2000);
    INSERT INTO public.provider_services (provider_id,service_id,status,price_override) VALUES ('${IDS.provider}','${NIGHT}','approved',900);
    UPDATE public.provider_services SET price_override = 1000 WHERE service_id = '${IDS.cleaningService}';
    INSERT INTO public.zone_services VALUES ('${IDS.zone}','${NIGHT}');
    INSERT INTO public.availability_rules SELECT '${IDS.provider}', day, '00:00'::time, '24:00'::time FROM generate_series(0,6) day;
  `);
  await db.exec(readMigration(MIGRATION));
  const pricing = readMigration(LATEST_PRICING).match(
    /CREATE OR REPLACE FUNCTION public\.tg_validate_booking_service\(\)[\s\S]*?\n\$\$;/,
  )?.[0];
  if (!pricing) throw new Error("Tracked pricing trigger not found");
  await db.exec(pricing);
  await db.exec(
    `CREATE TRIGGER trg_validate_booking_service BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service()`,
  );
});
afterEach(async () => {
  await db?.close();
});

async function book(serviceId: string, start: string, hours: number) {
  await db.exec("BEGIN; SELECT set_config('app.create_booking_in_progress','on',true)");
  try {
    const result = await db.query<{ id: string; price_subtotal: string }>(
      `
      INSERT INTO public.bookings (customer_id,provider_id,service_id,address_id,start_at,end_at)
      SELECT $1,$2,$3,$4, t, t + make_interval(hours => $6)
      FROM (SELECT (((now() AT TIME ZONE 'Africa/Cairo')::date + 2) + $5::time) AT TIME ZONE 'Africa/Cairo' AS t) x
      RETURNING id,price_subtotal`,
      [IDS.customer, IDS.provider, serviceId, IDS.address, start, hours],
    );
    await db.exec("COMMIT");
    return result.rows[0]!;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

it("sets only the two package definitions and preserves their limits", async () => {
  const { rows } = await db.query(
    `SELECT slug,pricing_model,duration_min,fixed_start_time::text,minimum_price::int,maximum_price::int FROM public.services WHERE slug IS NOT NULL ORDER BY slug`,
  );
  expect(rows).toEqual([
    {
      slug: "babysetting",
      pricing_model: "fixed",
      duration_min: 480,
      fixed_start_time: null,
      minimum_price: 800,
      maximum_price: 2000,
    },
    {
      slug: "overnight-babysitting",
      pricing_model: "fixed",
      duration_min: 360,
      fixed_start_time: "18:00:00",
      minimum_price: 500,
      maximum_price: 2000,
    },
  ]);
});
it("charges the fixed override once, and falls back to the provider rate", async () => {
  expect(Number((await book(IDS.cleaningService, "09:00", 8)).price_subtotal)).toBe(1000);
  await db.exec(
    `DELETE FROM public.bookings; UPDATE public.provider_services SET price_override=NULL WHERE service_id='${IDS.cleaningService}'; UPDATE public.providers SET hourly_rate=1200 WHERE id='${IDS.provider}'`,
  );
  expect(Number((await book(IDS.cleaningService, "09:00", 8)).price_subtotal)).toBe(1200);
});
it("rejects wrong fixed duration on insert and schedule update", async () => {
  await expect(book(IDS.cleaningService, "09:00", 7)).rejects.toThrow(
    /BOOKING_INVALID_BOOKING_REQUEST: Booking duration/,
  );
  const row = await book(IDS.cleaningService, "09:00", 8);
  await expect(
    db.query(`UPDATE public.bookings SET end_at=end_at-interval '1 hour' WHERE id=$1`, [row.id]),
  ).rejects.toThrow(/Booking duration/);
});
it("rejects overnight starts other than 18:00 Cairo", async () => {
  await expect(book(NIGHT, "17:00", 6)).rejects.toThrow(
    /BOOKING_INVALID_BOOKING_REQUEST: Booking must start/,
  );
});
it("accepts 18:00 to next-day 00:00 against an 18:00–24:00 rule", async () => {
  await db.exec(`UPDATE public.availability_rules SET start_time='18:00',end_time='24:00'`);
  expect(Number((await book(NIGHT, "18:00", 6)).price_subtotal)).toBe(900);
});
it("does not confuse a midnight rule with end of day and keeps overlap guards", async () => {
  await db.exec(`UPDATE public.availability_rules SET start_time='18:00',end_time='23:59'`);
  await expect(book(NIGHT, "18:00", 6)).rejects.toThrow(/BOOKING_SLOT_UNAVAILABLE/);
  await db.exec(`UPDATE public.availability_rules SET end_time='24:00'`);
  await book(NIGHT, "18:00", 6);
  await expect(book(NIGHT, "18:00", 6)).rejects.toThrow(/BOOKING_SLOT_UNAVAILABLE/);
});
it.each([
  ["23:00", 2],
  ["18:00", 7],
  ["18:00", 30],
])("rejects other cross-midnight windows: %s plus %s hours", async (start, hours) => {
  // Use the unchanged hourly path to prove the shared slot guard, not the new
  // package-duration trigger, rejects these windows.
  await db.exec(
    `UPDATE public.services SET pricing_model='hourly' WHERE id='${IDS.cleaningService}'`,
  );
  await expect(book(IDS.cleaningService, start, hours)).rejects.toThrow(/BOOKING_SLOT_UNAVAILABLE/);
  await expect(
    db.query(
      `SELECT public.check_booking_slot($1, t, t + make_interval(hours => $3), NULL)
       FROM (SELECT (((now() AT TIME ZONE 'Africa/Cairo')::date + 2) + $2::time)
         AT TIME ZONE 'Africa/Cairo' AS t) x`,
      [IDS.provider, start, hours],
    ),
  ).rejects.toThrow(/Bookings cannot span past midnight/);
});
it("keeps hourly multiplication and permits arbitrary hourly durations", async () => {
  await db.exec(
    `UPDATE public.services SET pricing_model='hourly',fixed_start_time='18:00' WHERE id='${IDS.cleaningService}'`,
  );
  expect(Number((await book(IDS.cleaningService, "09:00", 2)).price_subtotal)).toBe(2000);
});
it("does not change existing snapshots or block status-only updates after catalog changes", async () => {
  await db.exec(
    `UPDATE public.services SET pricing_model='hourly' WHERE id='${IDS.cleaningService}'`,
  );
  const row = await book(IDS.cleaningService, "09:00", 2);
  await db.exec(
    `UPDATE public.services SET pricing_model='fixed' WHERE id='${IDS.cleaningService}'`,
  );
  await db.query(`UPDATE public.bookings SET status='confirmed',start_at=start_at WHERE id=$1`, [
    row.id,
  ]);
  const result = await db.query<{ price_subtotal: string }>(
    `SELECT price_subtotal FROM public.bookings WHERE id=$1`,
    [row.id],
  );
  expect(Number(result.rows[0]!.price_subtotal)).toBe(2000);
});
it("replays the full migration history cleanly", async () => {
  const replay = await createMigrationReplayDb();
  try {
    await replayAllMigrations(replay);
    const { rows } = await replay.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='services' AND column_name='fixed_start_time'`,
    );
    expect(rows).toHaveLength(1);
  } finally {
    await replay.close();
  }
}, 60000);
