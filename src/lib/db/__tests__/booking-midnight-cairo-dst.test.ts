import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  createDisposableDb,
  IDS,
  readMigration,
  seedIdentities,
} from "./babysitting-capabilities-harness";
import { stableCairoBookingBaseDate } from "./cairo-stable-booking-date";

const FIXED_PACKAGES_MIGRATION = "20261005100000_fixed_price_babysitting_packages.sql";
const DST_MIGRATION = "20261027100000_booking_midnight_cairo_dst.sql";
const NIGHT = "00000000-0000-0000-0000-000000000999";

/** Stable Cairo calendar day with no DST transition in the booking window. */
const CAIRO_NORMAL_DAY = stableCairoBookingBaseDate(new Date("2026-11-01T12:00:00Z"));
/** Egypt DST fall-back night (clocks back at midnight). */
const CAIRO_DST_FALL_BACK_DATE = "2026-10-29";
/** Egypt DST spring-forward night (clocks forward at midnight), after `now()` in CI. */
const CAIRO_DST_SPRING_FORWARD_DATE = "2027-04-30";

let db: PGlite;

beforeEach(async () => {
  db = await createDisposableDb();
  await seedIdentities(db);
  await applyBabysittingMigration(db);
  await db.exec(`
    ALTER TABLE public.services ADD slug text, ADD duration_min int DEFAULT 60,
      ADD description_en text, ADD description_ar text;
    ALTER TABLE public.providers ADD is_active boolean DEFAULT true,
      ADD vacation_mode boolean DEFAULT false, ADD min_notice_hours int DEFAULT 0,
      ADD max_advance_days int DEFAULT 3650, ADD buffer_minutes int DEFAULT 0;
    CREATE TABLE public.availability_rules (provider_id uuid, weekday smallint, start_time time, end_time time);
    CREATE TABLE public.provider_vacations (provider_id uuid, start_date date, end_date date);
    CREATE TABLE public.availability_exceptions (provider_id uuid, date date, end_date date, start_time time, end_time time, is_blocked boolean);
    DROP FUNCTION IF EXISTS public.check_booking_slot(uuid,timestamptz,timestamptz,uuid);
    INSERT INTO public.availability_rules SELECT '${IDS.provider}', day, '00:00'::time, '24:00'::time FROM generate_series(0,6) day;
  `);
  await db.exec(readMigration(FIXED_PACKAGES_MIGRATION));
  await db.exec(readMigration(DST_MIGRATION));
});

afterEach(async () => {
  await db?.close();
});

async function assertSlot(
  cairoDate: string,
  startTime: string,
  hours: number,
  expectAccept: boolean,
) {
  const query = db.query(
    `SELECT public.check_booking_slot($1, t, t + make_interval(hours => $3), NULL)
     FROM (SELECT (($4::date + $2::time) AT TIME ZONE 'Africa/Cairo') AS t) x`,
    [IDS.provider, startTime, hours, cairoDate],
  );
  if (expectAccept) {
    await expect(query).resolves.toBeDefined();
  } else {
    await expect(query).rejects.toThrow(/Bookings cannot span past midnight/);
  }
}

describe("check_booking_slot midnight rule (Africa/Cairo)", () => {
  it.each([
    { label: "normal day", cairoDate: CAIRO_NORMAL_DAY },
    { label: "DST fall-back night", cairoDate: CAIRO_DST_FALL_BACK_DATE },
    { label: "DST spring-forward night", cairoDate: CAIRO_DST_SPRING_FORWARD_DATE },
  ])("$label: accepts 18:00 + 6h and rejects 18:00 + 7h", async ({ cairoDate }) => {
    await assertSlot(cairoDate, "18:00", 6, true);
    await assertSlot(cairoDate, "18:00", 7, false);
  });
});

describe("overnight fixed package on DST fall-back night", () => {
  beforeEach(async () => {
    await db.exec(`
      ALTER TABLE public.bookings ADD price_commission_percent numeric,
        ADD price_commission_amount numeric, ADD price_provider_net numeric;
      INSERT INTO public.services (id, category_id, slug, pricing_model, duration_min, fixed_start_time, minimum_price, maximum_price)
        VALUES ('${NIGHT}', '${IDS.cleaningCategory}', 'overnight-babysitting', 'fixed', 360, time '18:00', 500, 2000);
      INSERT INTO public.provider_services (provider_id,service_id,status,price_override)
        VALUES ('${IDS.provider}','${NIGHT}','approved',900);
      UPDATE public.availability_rules SET start_time='18:00', end_time='24:00';
    `);
  });

  it("still accepts 18:00 + 6h and rejects wrong duration", async () => {
    await db.exec("BEGIN; SELECT set_config('app.create_booking_in_progress','on',true)");
    try {
      await db.query(
        `
        INSERT INTO public.bookings (customer_id,provider_id,service_id,address_id,start_at,end_at)
        SELECT $1,$2,$3,$4, t, t + make_interval(hours => 6)
        FROM (SELECT (($5::date + time '18:00') AT TIME ZONE 'Africa/Cairo') AS t) x
        `,
        [IDS.customer, IDS.provider, NIGHT, IDS.address, CAIRO_DST_FALL_BACK_DATE],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    await assertSlot(CAIRO_DST_FALL_BACK_DATE, "18:00", 7, false);
  });
});
