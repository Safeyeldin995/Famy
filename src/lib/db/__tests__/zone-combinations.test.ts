import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const PROVIDER_USER = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const ZONE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ZONE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ZONE_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const ADDRESS_IN_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/20261111140000_provider_dual_zone_combinations.sql",
    import.meta.url,
  ),
);

/** Mirrors marketplace_eligibility_internal address_covered (zone_providers join). */
const ELIGIBILITY_SQL = `
CREATE OR REPLACE FUNCTION public.point_in_polygon(
  p_lat double precision, p_lng double precision, p_polygon jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid, service_id uuid,
  address_covered boolean, is_eligible boolean
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT c.id, c.service_id,
    CASE WHEN p_address_id IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.addresses a
      JOIN public.zones z ON z.is_active AND (
        (z.boundary_type = 'polygon' AND public.point_in_polygon(a.lat, a.lng, z.polygon))
        OR (z.boundary_type = 'circle' AND 6371 * acos(LEAST(1, GREATEST(-1,
          cos(radians(a.lat)) * cos(radians(z.center_lat)) * cos(radians(z.center_lng) - radians(a.lng))
          + sin(radians(a.lat)) * sin(radians(z.center_lat))))) <= z.radius_km)
      )
      JOIN public.zone_services zs ON zs.zone_id = z.id AND zs.service_id = c.service_id
      JOIN public.zone_providers zp ON zp.zone_id = z.id AND zp.provider_id = c.id
      WHERE a.id = p_address_id AND a.lat IS NOT NULL AND a.lng IS NOT NULL
    ) END AS address_covered,
    false AS is_eligible
  FROM (
    SELECT p.id, ps.service_id
    FROM public.providers p
    JOIN public.provider_services ps ON ps.provider_id = p.id
    WHERE p.id = p_provider_id AND (p_service_id IS NULL OR ps.service_id = p_service_id)
  ) c;
$$;
`;

async function readyDatabase() {
  const db = new PGlite();
  await db.exec(
    [
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
      "CREATE SCHEMA auth;",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
      "CREATE TYPE public.app_role AS ENUM ('customer', 'provider', 'admin');",
      "CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$",
      "  SELECT (_role = 'admin' AND _user_id = '11111111-1111-4111-8111-111111111111'::uuid)",
      "      OR (_role = 'provider' AND _user_id = '22222222-2222-4222-8222-222222222222'::uuid)",
      " $$;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;",
      "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;",
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;",
      "CREATE TABLE public.providers (id uuid PRIMARY KEY, profile_id uuid NOT NULL, onboarding_status text NOT NULL);",
      "CREATE TABLE public.provider_age_group_capabilities (",
      "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid, age_group_code text,",
      "  years_experience int, note text, verified_at timestamptz, verified_by uuid",
      ");",
      "CREATE TABLE public.zones (",
      "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
      "  name_en text NOT NULL, name_ar text NOT NULL, is_active boolean NOT NULL DEFAULT true,",
      "  center_lat double precision NOT NULL, center_lng double precision NOT NULL,",
      "  radius_km numeric(6,2) NOT NULL, travel_fee numeric(10,2) NOT NULL DEFAULT 0,",
      "  boundary_type text NOT NULL DEFAULT 'circle', polygon jsonb",
      ");",
      "CREATE TABLE public.zone_providers (",
      "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
      "  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,",
      "  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,",
      "  created_at timestamptz NOT NULL DEFAULT now(),",
      "  UNIQUE (zone_id, provider_id)",
      ");",
      "CREATE TABLE public.zone_services (",
      "  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,",
      "  service_id uuid NOT NULL, PRIMARY KEY (zone_id, service_id)",
      ");",
      "CREATE TABLE public.services (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);",
      "CREATE TABLE public.provider_services (provider_id uuid NOT NULL, service_id uuid NOT NULL, status text NOT NULL, PRIMARY KEY (provider_id, service_id));",
      "CREATE TABLE public.addresses (id uuid PRIMARY KEY, lat double precision, lng double precision);",
      "CREATE TABLE public.provider_onboarding_events (",
      "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid, actor_id uuid,",
      "  actor_role text, action text, previous_status text, new_status text, metadata jsonb",
      ");",
      "CREATE FUNCTION public.log_provider_onboarding_event(",
      "  p_provider_id uuid, p_actor_id uuid, p_actor_role text, p_action text,",
      "  p_previous_status text, p_new_status text, p_metadata jsonb DEFAULT '{}'::jsonb",
      ") RETURNS void LANGUAGE plpgsql AS $$ BEGIN",
      "  INSERT INTO public.provider_onboarding_events (provider_id, actor_id, actor_role, action, previous_status, new_status, metadata)",
      "  VALUES (p_provider_id, p_actor_id, p_actor_role, p_action, p_previous_status, p_new_status, COALESCE(p_metadata, '{}'::jsonb));",
      "END; $$;",
      `INSERT INTO public.providers VALUES ('${PROVIDER_ID}', '${PROVIDER_USER}', 'APPROVED');`,
      `INSERT INTO public.services VALUES ('${SERVICE_ID}', true);`,
      `INSERT INTO public.provider_services VALUES ('${PROVIDER_ID}', '${SERVICE_ID}', 'approved');`,
      `INSERT INTO public.zones VALUES ('${ZONE_A}', 'Zone A', 'أ', true, 29.00, 31.00, 5, 0, 'circle', NULL);`,
      `INSERT INTO public.zones VALUES ('${ZONE_B}', 'Zone B', 'ب', true, 30.05, 31.05, 5, 0, 'circle', NULL);`,
      `INSERT INTO public.zones VALUES ('${ZONE_C}', 'Zone C', 'ج', true, 29.90, 31.40, 2, 0, 'circle', NULL);`,
      `INSERT INTO public.zone_services VALUES ('${ZONE_A}', '${SERVICE_ID}'), ('${ZONE_B}', '${SERVICE_ID}'), ('${ZONE_C}', '${SERVICE_ID}');`,
      `INSERT INTO public.addresses VALUES ('${ADDRESS_IN_B}', 30.05, 31.05);`,
    ].join("\n"),
  );
  await db.exec(readFileSync(migrationPath, "utf8"));
  await db.exec(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.zone_combinations TO authenticated, anon;",
  );
  await db.exec(ELIGIBILITY_SQL);
  return db;
}

async function asRole<T>(
  db: PGlite,
  uid: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return result.rows;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

describe("provider dual-zone combinations", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("allows a single zone without a combination and rejects a third zone", async () => {
    db = await readyDatabase();
    await db.query(`INSERT INTO public.zone_providers (provider_id, zone_id) VALUES ('${PROVIDER_ID}', '${ZONE_A}')`);
    const one = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.zone_providers WHERE provider_id = '${PROVIDER_ID}'`,
    );
    expect(one.rows[0].n).toBe(1);

    await expect(
      db.query(
        `INSERT INTO public.zone_providers (provider_id, zone_id) VALUES ('${PROVIDER_ID}', '${ZONE_B}')`,
      ),
    ).rejects.toThrow(/cannot be combined/i);

    await db.query(
      `INSERT INTO public.zone_combinations (zone_a, zone_b) VALUES (LEAST('${ZONE_A}'::uuid, '${ZONE_B}'::uuid), GREATEST('${ZONE_A}'::uuid, '${ZONE_B}'::uuid))`,
    );
    await db.query(
      `INSERT INTO public.zone_providers (provider_id, zone_id) VALUES ('${PROVIDER_ID}', '${ZONE_B}')`,
    );
    expect(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.zone_providers WHERE provider_id = '${PROVIDER_ID}'`,
        )
      ).rows[0].n,
    ).toBe(2);

    await db.query(
      `INSERT INTO public.zone_combinations (zone_a, zone_b) VALUES (LEAST('${ZONE_A}'::uuid, '${ZONE_C}'::uuid), GREATEST('${ZONE_A}'::uuid, '${ZONE_C}'::uuid))`,
    );
    await expect(
      db.query(
        `INSERT INTO public.zone_providers (provider_id, zone_id) VALUES ('${PROVIDER_ID}', '${ZONE_C}')`,
      ),
    ).rejects.toThrow(/at most two zones/i);
  });

  it("allows only combinable pairs via helper and trigger", async () => {
    db = await readyDatabase();
    await expect(
      db.query(
        `SELECT public.replace_provider_zone_coverage('${PROVIDER_ID}', ARRAY['${ZONE_A}'::uuid, '${ZONE_B}'::uuid])`,
      ),
    ).rejects.toThrow(/cannot be combined/i);

    expect(await db.query(`SELECT public.zones_can_combine('${ZONE_A}', '${ZONE_B}')`).then((r) => r.rows[0])).toEqual({
      zones_can_combine: false,
    });

    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
    await db.query(
      `SELECT public.admin_sync_zone_combinations('${ZONE_A}', ARRAY['${ZONE_B}'::uuid])`,
    );
    expect(
      (await db.query<{ zones_can_combine: boolean }>(`SELECT public.zones_can_combine('${ZONE_B}', '${ZONE_A}')`))
        .rows[0].zones_can_combine,
    ).toBe(true);

    const stored = await db.query<{ zone_a: string; zone_b: string }>(
      `SELECT zone_a::text, zone_b::text FROM public.zone_combinations`,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].zone_a < stored.rows[0].zone_b).toBe(true);

    await db.query(
      `SELECT public.replace_provider_zone_coverage('${PROVIDER_ID}', ARRAY['${ZONE_A}'::uuid, '${ZONE_B}'::uuid])`,
    );
    const zones = (
      await db.query<{ zone_id: string }>(
        `SELECT zone_id::text FROM public.zone_providers WHERE provider_id = '${PROVIDER_ID}' ORDER BY zone_id`,
      )
    ).rows.map((r) => r.zone_id);
    expect(zones).toEqual([ZONE_A, ZONE_B].sort());
  });

  it("finds a provider through the second zone in marketplace_eligibility_internal address_covered", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
    await db.query(
      `SELECT public.admin_sync_zone_combinations('${ZONE_A}', ARRAY['${ZONE_B}'::uuid])`,
    );
    await db.query(
      `SELECT public.replace_provider_zone_coverage('${PROVIDER_ID}', ARRAY['${ZONE_A}'::uuid, '${ZONE_B}'::uuid])`,
    );

    const uncovered = await db.query<{ address_covered: boolean }>(
      `SELECT address_covered FROM public.marketplace_eligibility_internal('${PROVIDER_ID}', '${SERVICE_ID}', '${ADDRESS_IN_B}')`,
    );
    expect(uncovered.rows[0].address_covered).toBe(true);

    await db.query(`DELETE FROM public.zone_providers WHERE zone_id = '${ZONE_B}'`);
    const onlyPrimary = await db.query<{ address_covered: boolean }>(
      `SELECT address_covered FROM public.marketplace_eligibility_internal('${PROVIDER_ID}', '${SERVICE_ID}', '${ADDRESS_IN_B}')`,
    );
    expect(onlyPrimary.rows[0].address_covered).toBe(false);
  });

  it("blocks non-admins from writing combinations via RLS and the admin RPC", async () => {
    db = await readyDatabase();
    await expect(
      asRole(
        db,
        PROVIDER_USER,
        `INSERT INTO public.zone_combinations (zone_a, zone_b) VALUES ('${ZONE_A}', '${ZONE_B}')`,
      ),
    ).rejects.toThrow();

    await expect(
      asRole(
        db,
        CUSTOMER,
        `SELECT public.admin_sync_zone_combinations($1::uuid, ARRAY[$2::uuid])`,
        [ZONE_A, ZONE_B],
      ),
    ).rejects.toThrow(/admin authorization required/i);

    await asRole(db, ADMIN, `SELECT public.admin_sync_zone_combinations($1::uuid, ARRAY[$2::uuid])`, [
      ZONE_A,
      ZONE_B,
    ]);
    expect(
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.zone_combinations`)).rows[0]
        .n,
    ).toBe(1);

    const publicRead = await asRole<{ zone_a: string }>(
      db,
      CUSTOMER,
      `SELECT zone_a::text FROM public.zone_combinations`,
    );
    expect(publicRead).toHaveLength(1);
  });

  it("blocks removing an in-use pair and applies an approved provider's second zone with audit", async () => {
    db = await readyDatabase();
    await db.query(`SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false)`);
    await db.query(
      `SELECT public.admin_sync_zone_combinations('${ZONE_A}', ARRAY['${ZONE_B}'::uuid, '${ZONE_C}'::uuid])`,
    );
    await db.query(
      `SELECT public.replace_provider_zone_coverage('${PROVIDER_ID}', ARRAY['${ZONE_A}'::uuid, '${ZONE_B}'::uuid])`,
    );

    await expect(
      db.query(`DELETE FROM public.zone_combinations WHERE zone_a = LEAST('${ZONE_A}'::uuid, '${ZONE_B}'::uuid)`),
    ).rejects.toThrow(/still serve both zones/i);

    await expect(
      db.query(`SELECT public.admin_sync_zone_combinations('${ZONE_A}', ARRAY['${ZONE_C}'::uuid])`),
    ).rejects.toThrow(/still serve both zones/i);

    await db.query(`SELECT set_config('request.jwt.claim.sub', '${PROVIDER_USER}', false)`);
    await db.query(`SELECT public.provider_update_service_zones('${ZONE_A}', '${ZONE_B}')`);
    const events = await db.query<{ action: string; metadata: { secondary_zone_id: string } }>(
      `SELECT action, metadata FROM public.provider_onboarding_events WHERE action = 'service_zones_updated'`,
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].metadata.secondary_zone_id).toBe(ZONE_B);

    await db.query(`UPDATE public.providers SET onboarding_status = 'DRAFT' WHERE id = '${PROVIDER_ID}'`);
    await expect(
      db.query(`SELECT public.provider_update_service_zones('${ZONE_A}', '${ZONE_C}')`),
    ).rejects.toThrow(/approved providers/i);
  });
});
