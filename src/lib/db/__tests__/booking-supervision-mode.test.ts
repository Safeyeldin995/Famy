import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  queryRows,
  readMigration,
  runSqlExpectError,
} from "./expire-pending-bookings.harness";

const SUPERVISION_MIGRATION = "20261102140000_booking_supervision_mode.sql";

async function createSupervisionDb(): Promise<PGlite> {
  const { createExpiryDb } = await import("./expire-pending-bookings.harness");
  const db = await createExpiryDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.categories (
      id uuid PRIMARY KEY,
      slug text NOT NULL UNIQUE
    );
    ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id);
    INSERT INTO public.categories (id, slug) VALUES
      ('00000000-0000-0000-0000-00000000bb01', 'babysitting'),
      ('00000000-0000-0000-0000-00000000bb02', 'home-cleaning')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.services SET category_id = '00000000-0000-0000-0000-00000000bb02' WHERE id = '${IDS.service}';
  `);
  await db.exec(readMigration(SUPERVISION_MIGRATION));
  return db;
}

describe("create_booking supervision_mode RPC", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createSupervisionDb();
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [IDS.customer]);
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects babysitting bookings without supervision_mode", async () => {
    await db.exec(`
      INSERT INTO public.services (id, name_en, category_id)
      VALUES ('00000000-0000-0000-0000-00000000bb10', 'Babysitting', '00000000-0000-0000-0000-00000000bb01')
      ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id;
    `);
    await runSqlExpectError(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          now() + interval '5 days', now() + interval '5 days 2 hours',
          gen_random_uuid(), NULL, NULL, NULL, '[]'::jsonb,
          NULL, NULL, NULL, NULL, NULL
        )
      `,
      [IDS.provider, "00000000-0000-0000-0000-00000000bb10", IDS.address],
      /BOOKING_SUPERVISION_REQUIRED/,
    );
  });

  it("accepts non-childcare services without supervision_mode", async () => {
    const rows = await queryRows<{ create_booking: { booking_id: string } }>(
      db,
      `
        SELECT public.create_booking(
          $1::uuid, $2::uuid, $3::uuid,
          now() + interval '5 days', now() + interval '5 days 2 hours',
          gen_random_uuid(), NULL, NULL, NULL, '[]'::jsonb,
          NULL, NULL, NULL, NULL, NULL
        ) AS create_booking
      `,
      [IDS.provider, IDS.service, IDS.address],
    );
    expect(rows[0]?.create_booking?.booking_id).toBeTruthy();
  });
});
