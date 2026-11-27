import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION = "20261127010000_promo_mode_scope.sql";

const IDS = {
  customer: "00000000-0000-0000-0000-0000000000c1",
  tutoring: "00000000-0000-0000-0000-0000000000a1",
  cleaning: "00000000-0000-0000-0000-0000000000a2",
  quran: "00000000-0000-0000-0000-0000000000b1",
  math: "00000000-0000-0000-0000-0000000000b2",
  cleaningService: "00000000-0000-0000-0000-0000000000b3",
};

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.categories (id uuid PRIMARY KEY, online_allowed boolean NOT NULL DEFAULT false);
CREATE TABLE public.services (
  id uuid PRIMARY KEY,
  category_id uuid REFERENCES public.categories(id),
  online_allowed boolean NOT NULL DEFAULT false
);
CREATE TABLE public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description_en text,
  description_ar text,
  discount_type text NOT NULL DEFAULT 'fixed',
  discount_value numeric(10,2) NOT NULL DEFAULT 50,
  maximum_discount numeric(10,2),
  minimum_booking_amount numeric(10,2) NOT NULL DEFAULT 0,
  starts_at timestamptz,
  expires_at timestamptz,
  total_usage_limit int,
  usage_limit_per_customer int,
  usage_count int NOT NULL DEFAULT 0,
  first_booking_only boolean NOT NULL DEFAULT false,
  applicable_scope text NOT NULL DEFAULT 'all'
    CHECK (applicable_scope IN ('all','categories','services')),
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.promo_code_services (promo_code_id uuid, service_id uuid);
CREATE TABLE public.promo_code_categories (promo_code_id uuid, category_id uuid);
CREATE TABLE public.promo_code_redemptions (promo_code_id uuid, customer_id uuid);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  service_id uuid NOT NULL,
  service_mode text NOT NULL DEFAULT 'in_person',
  promo_code_id uuid
);

-- The previous 3-argument preflight, which the migration must replace.
CREATE FUNCTION public.validate_promo_code(p_code text, p_service_id uuid, p_subtotal numeric)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok": true}'::jsonb $$;
CREATE FUNCTION public.get_active_featured_promo_codes()
RETURNS TABLE (id uuid) LANGUAGE sql AS $$ SELECT NULL::uuid WHERE false $$;

INSERT INTO public.categories (id, online_allowed) VALUES
  ('${IDS.tutoring}', true), ('${IDS.cleaning}', false);
INSERT INTO public.services (id, category_id, online_allowed) VALUES
  ('${IDS.quran}', '${IDS.tutoring}', true),
  ('${IDS.math}', '${IDS.tutoring}', true),
  ('${IDS.cleaningService}', '${IDS.cleaning}', false);
`;

function readMigration(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "supabase/migrations", name), "utf8");
}

async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(readMigration(MIGRATION));
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [IDS.customer]);
  return db;
}

async function addPromo(
  db: PGlite,
  code: string,
  mode: "all" | "online" | "in_person",
  scope: { services?: string[]; categories?: string[] } = {},
): Promise<string> {
  const applicableScope = scope.services ? "services" : scope.categories ? "categories" : "all";
  const res = await db.query<{ id: string }>(
    `INSERT INTO public.promo_codes (code, applicable_mode, applicable_scope, is_featured)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [code, mode, applicableScope],
  );
  const id = res.rows[0]!.id;
  for (const s of scope.services ?? []) {
    await db.query(`INSERT INTO public.promo_code_services VALUES ($1, $2)`, [id, s]);
  }
  for (const c of scope.categories ?? []) {
    await db.query(`INSERT INTO public.promo_code_categories VALUES ($1, $2)`, [id, c]);
  }
  return id;
}

async function validate(
  db: PGlite,
  code: string,
  serviceId: string,
  mode: string | null,
): Promise<{ ok: boolean; reason?: string; discount_amount?: number }> {
  const res = await db.query<{ r: { ok: boolean; reason?: string; discount_amount?: number } }>(
    `SELECT public.validate_promo_code(p_code => $1, p_service_id => $2::uuid, p_subtotal => 300, p_service_mode => $3) AS r`,
    [code, serviceId, mode],
  );
  return res.rows[0]!.r;
}

async function book(db: PGlite, serviceId: string, mode: string, promoId: string) {
  await db.query(
    `INSERT INTO public.bookings (customer_id, service_id, service_mode, promo_code_id)
     VALUES ($1, $2, $3, $4)`,
    [IDS.customer, serviceId, mode, promoId],
  );
}

describe("promo codes scoped by booking mode", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("an online-only promo applies to an online booking", async () => {
    const id = await addPromo(db, "ONLINE50", "online");
    const r = await validate(db, "online50", IDS.math, "online");
    expect(r.ok).toBe(true);
    expect(Number(r.discount_amount)).toBe(50);
    await expect(book(db, IDS.math, "online", id)).resolves.toBeUndefined();
  });

  it("an online-only promo is refused on an in-person booking, in preflight and on insert", async () => {
    const id = await addPromo(db, "ONLINE50", "online");
    expect(await validate(db, "ONLINE50", IDS.math, "in_person")).toEqual({
      ok: false,
      reason: "mode_online_only",
    });
    await expect(book(db, IDS.math, "in_person", id)).rejects.toThrow(/BOOKING_INVALID_PROMO/);
    const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.bookings`);
    expect(count.rows[0]!.n).toBe(0);
  });

  it("an at-home-only promo is refused on an online booking", async () => {
    const id = await addPromo(db, "HOME20", "in_person");
    expect(await validate(db, "HOME20", IDS.math, "online")).toEqual({
      ok: false,
      reason: "mode_in_person_only",
    });
    await expect(book(db, IDS.math, "online", id)).rejects.toThrow(/BOOKING_INVALID_PROMO/);
    await expect(book(db, IDS.cleaningService, "in_person", id)).resolves.toBeUndefined();
  });

  it("combines the mode with the service scope: online lessons, Quran only", async () => {
    const id = await addPromo(db, "QURANONLINE", "online", { services: [IDS.quran] });
    expect((await validate(db, "QURANONLINE", IDS.quran, "online")).ok).toBe(true);
    expect(await validate(db, "QURANONLINE", IDS.math, "online")).toEqual({
      ok: false,
      reason: "not_applicable",
    });
    expect(await validate(db, "QURANONLINE", IDS.quran, "in_person")).toEqual({
      ok: false,
      reason: "mode_online_only",
    });
    await expect(book(db, IDS.quran, "in_person", id)).rejects.toThrow(/BOOKING_INVALID_PROMO/);
    await expect(book(db, IDS.quran, "online", id)).resolves.toBeUndefined();
  });

  it("combines the mode with the category scope", async () => {
    await addPromo(db, "TUTORONLINE", "online", { categories: [IDS.tutoring] });
    expect((await validate(db, "TUTORONLINE", IDS.math, "online")).ok).toBe(true);
    expect((await validate(db, "TUTORONLINE", IDS.cleaningService, "online")).reason).toBe(
      "not_applicable",
    );
  });

  it("keeps existing codes (mode all) working for both modes", async () => {
    const id = await addPromo(db, "WELCOME", "all");
    expect((await validate(db, "WELCOME", IDS.math, "online")).ok).toBe(true);
    expect((await validate(db, "WELCOME", IDS.math, "in_person")).ok).toBe(true);
    await expect(book(db, IDS.math, "online", id)).resolves.toBeUndefined();
    await expect(book(db, IDS.math, "in_person", id)).resolves.toBeUndefined();
  });

  it("leaves an unknown mode from old clients to the booking insert check", async () => {
    await addPromo(db, "ONLINE50", "online");
    const res = await db.query<{ r: { ok: boolean } }>(
      `SELECT public.validate_promo_code(p_code => 'ONLINE50', p_service_id => $1::uuid, p_subtotal => 300) AS r`,
      [IDS.math],
    );
    expect(res.rows[0]!.r.ok).toBe(true);
  });

  it("rejects an invalid mode value on the promo", async () => {
    await expect(addPromo(db, "BAD", "everywhere" as "all")).rejects.toThrow(
      /promo_codes_applicable_mode_check/,
    );
  });

  it("returns the mode on featured codes", async () => {
    await addPromo(db, "ONLINE50", "online");
    const res = await db.query<{ code: string; applicable_mode: string }>(
      `SELECT code, applicable_mode FROM public.get_active_featured_promo_codes()`,
    );
    expect(res.rows).toEqual([{ code: "ONLINE50", applicable_mode: "online" }]);
  });

  it("keeps one preflight signature and the same grants", async () => {
    const sigs = await db.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'validate_promo_code'`,
    );
    expect(sigs.rows.map((r) => r.args)).toEqual([
      "p_code text, p_service_id uuid, p_subtotal numeric, p_service_mode text",
    ]);
    const grants = await db.query<{ anon: boolean; authed: boolean; trig: boolean; secdef: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.validate_promo_code(text, uuid, numeric, text)', 'EXECUTE') AS anon,
         has_function_privilege('authenticated', 'public.validate_promo_code(text, uuid, numeric, text)', 'EXECUTE') AS authed,
         has_function_privilege('authenticated', 'public.tg_booking_promo_mode_scope()', 'EXECUTE') AS trig,
         (SELECT prosecdef FROM pg_proc WHERE proname = 'tg_booking_promo_mode_scope') AS secdef`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, authed: true, trig: false, secdef: true });
  });
});
