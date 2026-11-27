import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261127000000_remove_qa_fixture_services.sql",
    import.meta.url,
  ),
);

const REAL = "00000000-0000-4000-8000-000000000001";
const QA_FREE = "00000000-0000-4000-8000-000000000002";
const QA_BOOKED = "00000000-0000-4000-8000-000000000003";
const QA_OFFERED = "00000000-0000-4000-8000-000000000004";
const REAL_QA_NAMED = "00000000-0000-4000-8000-000000000005";

async function seededDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.services (
      id uuid PRIMARY KEY, slug text NOT NULL, name_en text NOT NULL,
      is_active boolean NOT NULL DEFAULT true, deleted_at timestamptz
    );
    CREATE TABLE public.bookings (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT);
    CREATE TABLE public.provider_services (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.provider_teaching_capabilities (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id));
    CREATE TABLE public.promo_code_services (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.area_requests (id uuid PRIMARY KEY, service_id uuid REFERENCES public.services(id) ON DELETE SET NULL);
    CREATE TABLE public.tutor_demand_requests (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.service_requirements (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.zone_services (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.teaching_subject_services (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);
    CREATE TABLE public.service_teaching_levels (id uuid PRIMARY KEY, service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE);

    INSERT INTO public.services (id, slug, name_en) VALUES
      ('${REAL}', 'babysitting-hourly', 'Babysitting'),
      ('${QA_FREE}', 'qa-onboard-service-1785065232', 'QA Onboard Service'),
      ('${QA_BOOKED}', 'qa-booking-service-1785235277', 'QA Booking Service'),
      ('${QA_OFFERED}', 'QA_patch2-1784641407997', 'QA_Patch2_Marketplace'),
      ('${REAL_QA_NAMED}', 'home-cleaning-deep', 'Home Cleaning QA_');
    INSERT INTO public.service_requirements (id, service_id) VALUES
      (gen_random_uuid(), '${QA_FREE}'), (gen_random_uuid(), '${REAL}');
    INSERT INTO public.zone_services (id, service_id) VALUES (gen_random_uuid(), '${QA_FREE}');
    INSERT INTO public.bookings (id, service_id) VALUES (gen_random_uuid(), '${QA_BOOKED}');
    INSERT INTO public.provider_services (id, service_id) VALUES (gen_random_uuid(), '${QA_OFFERED}');
  `);
  return db;
}

async function serviceRows(db: PGlite) {
  const res = await db.query<{ id: string; is_active: boolean; deleted: boolean }>(
    "SELECT id, is_active, deleted_at IS NOT NULL AS deleted FROM public.services ORDER BY id",
  );
  return new Map(res.rows.map((r) => [r.id, r]));
}

describe("20261127000000 remove QA fixture services", () => {
  it("deletes unreferenced QA services with their config, archives referenced ones, keeps real ones", async () => {
    const db = await seededDatabase();
    await db.exec(readFileSync(migrationPath, "utf8"));

    const rows = await serviceRows(db);
    expect(rows.has(QA_FREE)).toBe(false);
    expect(rows.get(REAL)).toMatchObject({ is_active: true, deleted: false });
    // A real service whose display name ends with "QA_" is never touched (slug rule only).
    expect(rows.get(REAL_QA_NAMED)).toMatchObject({ is_active: true, deleted: false });
    // Referenced QA services are archived, not deleted.
    expect(rows.get(QA_BOOKED)).toMatchObject({ is_active: false, deleted: true });
    expect(rows.get(QA_OFFERED)).toMatchObject({ is_active: false, deleted: true });

    const reqs = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.service_requirements WHERE service_id = '${REAL}'`,
    );
    expect(reqs.rows[0].n).toBe(1);
    const bookings = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.bookings");
    expect(bookings.rows[0].n).toBe(1);
    await db.close();
  });

  it("is idempotent", async () => {
    const db = await seededDatabase();
    const sql = readFileSync(migrationPath, "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const rows = await serviceRows(db);
    expect(rows.size).toBe(4);
    await db.close();
  });
});
