import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export const BABYSITTING_MIGRATION = "20260912090000_babysitting_capabilities.sql";

export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

export type PrivilegeRow = {
  grantee: string;
  table_name: string;
  privilege: TablePrivilege;
  allowed: boolean;
};

export const IDS = {
  customer: "00000000-0000-0000-0000-000000000001",
  otherCustomer: "00000000-0000-0000-0000-000000000002",
  providerUser: "00000000-0000-0000-0000-000000000011",
  otherProviderUser: "00000000-0000-0000-0000-000000000012",
  adminUser: "00000000-0000-0000-0000-000000000021",
  providerAdminUser: "00000000-0000-0000-0000-000000000031",
  provider: "00000000-0000-0000-0000-000000000111",
  otherProvider: "00000000-0000-0000-0000-000000000112",
  providerAdminProvider: "00000000-0000-0000-0000-000000000113",
  babysittingCategory: "00000000-0000-0000-0000-000000000211",
  cleaningCategory: "00000000-0000-0000-0000-000000000212",
  babysittingService: "00000000-0000-0000-0000-000000000311",
  cleaningService: "00000000-0000-0000-0000-000000000312",
  zone: "00000000-0000-0000-0000-000000000411",
  address: "00000000-0000-0000-0000-000000000511",
  childMember: "00000000-0000-0000-0000-000000000611",
  teenMember: "00000000-0000-0000-0000-000000000612",
  inactiveMember: "00000000-0000-0000-0000-000000000613",
  otherChild: "00000000-0000-0000-0000-000000000614",
  tooOldMember: "00000000-0000-0000-0000-000000000615",
  futureMember: "00000000-0000-0000-0000-000000000616",
};

const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('customer', 'provider', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'provider_onboarding_status') THEN
    CREATE TYPE public.provider_onboarding_status AS ENUM (
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'SUSPENDED'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.provider_onboarding_editable(p_status public.provider_onboarding_status)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('DRAFT', 'NEEDS_CHANGES');
$$;

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  hourly_rate numeric(10,2) NOT NULL DEFAULT 100,
  onboarding_status public.provider_onboarding_status NOT NULL DEFAULT 'DRAFT'
);

CREATE TABLE IF NOT EXISTS public.provider_onboarding_details (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  child_age_groups text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES public.categories(id),
  is_active boolean NOT NULL DEFAULT true,
  pricing_model text NOT NULL DEFAULT 'hourly',
  provider_pricing_allowed boolean NOT NULL DEFAULT true,
  minimum_price numeric,
  maximum_price numeric,
  maximum_extras_total numeric
);

CREATE TABLE IF NOT EXISTS public.provider_services (
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  service_id uuid NOT NULL REFERENCES public.services(id),
  status text NOT NULL DEFAULT 'approved',
  price_override numeric,
  PRIMARY KEY (provider_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.addresses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  lat double precision,
  lng double precision
);

CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  boundary_type text NOT NULL DEFAULT 'polygon',
  polygon jsonb,
  center_lat double precision,
  center_lng double precision,
  radius_km numeric,
  travel_fee numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.zone_services (
  zone_id uuid NOT NULL REFERENCES public.zones(id),
  service_id uuid NOT NULL REFERENCES public.services(id),
  PRIMARY KEY (zone_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.zone_providers (
  zone_id uuid NOT NULL REFERENCES public.zones(id),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  PRIMARY KEY (zone_id, provider_id)
);

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  full_name text NOT NULL,
  relationship text NOT NULL DEFAULT 'daughter',
  date_of_birth date NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.service_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  required_during_booking boolean NOT NULL DEFAULT false,
  fulfillment_mode text,
  provider_extra_fee numeric NOT NULL DEFAULT 0,
  name_en text
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  service_id uuid NOT NULL,
  address_id uuid,
  family_member_id uuid,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  requirement_selections jsonb DEFAULT '[]'::jsonb,
  promo_code_id uuid,
  promo_code text,
  promo_discount_type text,
  promo_discount_value numeric,
  promo_description_en text,
  promo_description_ar text,
  price_subtotal numeric NOT NULL DEFAULT 0,
  price_discount numeric NOT NULL DEFAULT 0,
  price_total numeric NOT NULL DEFAULT 0,
  price_platform_fee numeric,
  price_vat numeric,
  price_extras_total numeric,
  price_travel_fee numeric
);

CREATE OR REPLACE FUNCTION public.point_in_polygon(
  p_lat double precision, p_lng double precision, p_polygon jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.resolve_zone(p_lat double precision, p_lng double precision)
RETURNS TABLE (zone_id uuid, travel_fee numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT z.id, COALESCE(z.travel_fee, 0)
  FROM public.zones z
  WHERE z.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.check_booking_slot(
  p_provider_id uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RETURN;
END;
$$;

INSERT INTO public.settings (key, value) VALUES
  ('billing', '{"platform_fee": 25, "vat_percent": 14}'::jsonb)
ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON public.providers, public.profiles, public.user_roles, public.categories, public.services TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_onboarding_editable(public.provider_onboarding_status) TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
`;

const SUPABASE_DEFAULT_PRIVILEGES_SQL = `
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
`;

export function readMigration(fileName: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

export async function queryRows<T extends Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = params ? await db.query<T>(sql, params) : await db.query<T>(sql);
  return result.rows;
}

export async function createDisposableDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SQL);
  return db;
}

export async function applySql(db: PGlite, sql: string): Promise<void> {
  await db.exec(sql);
}

export async function applySupabaseDefaultPrivileges(db: PGlite): Promise<void> {
  await db.exec(SUPABASE_DEFAULT_PRIVILEGES_SQL);
}

export async function grantPermissiveTableAcls(db: PGlite, tableName: string): Promise<void> {
  await db.exec(
    `GRANT ALL PRIVILEGES ON TABLE public.${tableName} TO PUBLIC, anon, authenticated, service_role`,
  );
}

export async function applyBabysittingMigration(db: PGlite): Promise<void> {
  await applySql(db, readMigration(BABYSITTING_MIGRATION));
}

export async function tablePrivilegeMatrix(db: PGlite, tableName: string): Promise<PrivilegeRow[]> {
  const rows = await queryRows<{
    grantee: string;
    privilege: TablePrivilege;
    allowed: boolean;
  }>(
    db,
    `
      SELECT
        r.rolname AS grantee,
        p.privilege,
        has_table_privilege(r.rolname, format('public.%I', $1::text), p.privilege) AS allowed
      FROM pg_roles r
      CROSS JOIN (
        SELECT unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]) AS privilege
      ) p
      WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
      ORDER BY r.rolname, p.privilege
    `,
    [tableName],
  );

  return rows.map((row) => ({
    table_name: tableName,
    grantee: row.grantee,
    privilege: row.privilege,
    allowed: row.allowed,
  }));
}

export async function publicTablePrivileges(
  db: PGlite,
  tableName: string,
): Promise<TablePrivilege[]> {
  const rows = await queryRows<{ privilege: TablePrivilege }>(
    db,
    `
      SELECT acl.privilege_type AS privilege
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND acl.grantee = 0
      ORDER BY 1
    `,
    [tableName],
  );
  return rows.map((row) => row.privilege);
}

export async function functionExecuteAllowed(
  db: PGlite,
  grantee: string,
  signature: string,
): Promise<boolean> {
  const rows = await queryRows<{ allowed: boolean }>(
    db,
    `SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed`,
    [grantee, signature],
  );
  return Boolean(rows[0]?.allowed);
}

export async function seedIdentities(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO public.profiles (id, full_name) VALUES
      ('${IDS.customer}', 'Customer'),
      ('${IDS.otherCustomer}', 'Other Customer'),
      ('${IDS.providerUser}', 'Provider'),
      ('${IDS.otherProviderUser}', 'Other Provider'),
      ('${IDS.adminUser}', 'Admin'),
      ('${IDS.providerAdminUser}', 'Provider Admin')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.customer}', 'customer'),
      ('${IDS.otherCustomer}', 'customer'),
      ('${IDS.providerUser}', 'provider'),
      ('${IDS.otherProviderUser}', 'provider'),
      ('${IDS.adminUser}', 'customer'),
      ('${IDS.adminUser}', 'admin'),
      ('${IDS.providerAdminUser}', 'provider'),
      ('${IDS.providerAdminUser}', 'admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status) VALUES
      ('${IDS.provider}', '${IDS.providerUser}', 100, 'DRAFT'),
      ('${IDS.otherProvider}', '${IDS.otherProviderUser}', 100, 'DRAFT'),
      ('${IDS.providerAdminProvider}', '${IDS.providerAdminUser}', 100, 'DRAFT')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.categories (id, slug) VALUES
      ('${IDS.babysittingCategory}', 'babysitting'),
      ('${IDS.cleaningCategory}', 'home-cleaning')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.services (id, category_id, is_active, pricing_model) VALUES
      ('${IDS.babysittingService}', '${IDS.babysittingCategory}', true, 'hourly'),
      ('${IDS.cleaningService}', '${IDS.cleaningCategory}', true, 'hourly')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.provider_services (provider_id, service_id, status, price_override) VALUES
      ('${IDS.provider}', '${IDS.babysittingService}', 'approved', 100),
      ('${IDS.provider}', '${IDS.cleaningService}', 'approved', 100)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.zones (id, is_active, boundary_type, polygon, travel_fee) VALUES
      ('${IDS.zone}', true, 'polygon', '[]'::jsonb, 0)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.zone_services (zone_id, service_id) VALUES
      ('${IDS.zone}', '${IDS.babysittingService}'),
      ('${IDS.zone}', '${IDS.cleaningService}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.zone_providers (zone_id, provider_id) VALUES
      ('${IDS.zone}', '${IDS.provider}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.addresses (id, user_id, lat, lng) VALUES
      ('${IDS.address}', '${IDS.customer}', 30.02, 31.015)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.family_members (id, customer_id, full_name, relationship, date_of_birth, is_active) VALUES
      ('${IDS.childMember}', '${IDS.customer}', 'Toddler', 'daughter', DATE '2024-09-28', true),
      ('${IDS.teenMember}', '${IDS.customer}', 'Teen', 'son', DATE '2011-09-28', true),
      ('${IDS.inactiveMember}', '${IDS.customer}', 'Inactive', 'daughter', DATE '2024-09-28', false),
      ('${IDS.otherChild}', '${IDS.otherCustomer}', 'Other child', 'son', DATE '2024-09-28', true),
      ('${IDS.tooOldMember}', '${IDS.customer}', 'Adult', 'son', DATE '2000-01-01', true),
      ('${IDS.futureMember}', '${IDS.customer}', 'Future', 'daughter', DATE '2027-01-01', true)
    ON CONFLICT (id) DO NOTHING;
  `);
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.exec("SET LOCAL ROLE authenticated");
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function tryAsUser(
  db: PGlite,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }> {
  try {
    const rows = await asUser(db, userId, async () => queryRows(db, sql, params));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const BOOKING_START = "2026-09-28T10:00:00Z";
export const BOOKING_END = "2026-09-28T12:00:00Z";

export async function insertBooking(
  db: PGlite,
  args: {
    serviceId: string;
    familyMemberId: string | null;
    providerId?: string;
    customerId?: string;
  },
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await db.exec("BEGIN");
  try {
    await db.exec("SELECT set_config('app.create_booking_in_progress', 'on', true)");
    const rows = await queryRows<{ id: string }>(
      db,
      `
        INSERT INTO public.bookings (
          customer_id, provider_id, service_id, address_id, family_member_id,
          start_at, end_at, status, price_subtotal, price_discount, price_total
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::timestamptz, $7::timestamptz, 'pending', 0, 0, 0
        )
        RETURNING id
      `,
      [
        args.customerId ?? IDS.customer,
        args.providerId ?? IDS.provider,
        args.serviceId,
        IDS.address,
        args.familyMemberId,
        BOOKING_START,
        BOOKING_END,
      ],
    );
    await db.exec("COMMIT");
    return { ok: true, id: rows[0]?.id };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
