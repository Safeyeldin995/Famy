import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./monitoring-privilege-harness";

export const CLOSED_BETA_MIGRATION = "20260929095936_closed_beta_babysitting_tutoring.sql";

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
END
$$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  avatar_url text
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id),
  slug text NOT NULL,
  name_en text NOT NULL DEFAULT '',
  name_ar text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  bio_en text NOT NULL DEFAULT '',
  bio_ar text NOT NULL DEFAULT '',
  hourly_rate numeric NOT NULL DEFAULT 100,
  years_experience integer NOT NULL DEFAULT 1,
  languages text[] NOT NULL DEFAULT '{}',
  city text NOT NULL DEFAULT 'Cairo',
  is_top_pro boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT true,
  response_time_min integer NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS public.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ratings_summary (
  provider_id uuid PRIMARY KEY,
  rating_avg numeric,
  rating_count integer
);

CREATE TABLE IF NOT EXISTS public.trust_scores (
  provider_id uuid PRIMARY KEY,
  score numeric
);

CREATE TABLE IF NOT EXISTS public.provider_services (
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  service_id uuid NOT NULL REFERENCES public.services(id),
  PRIMARY KEY (provider_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  family_member_id uuid
);

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (
  is_eligible boolean,
  service_id uuid,
  effective_price numeric,
  reason_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT true, ps.service_id, 100::numeric, NULL::text
  FROM public.provider_services ps
  JOIN public.services s ON s.id = ps.service_id AND s.is_active = true
  WHERE ps.provider_id = p_provider_id
    AND (p_service_id IS NULL OR ps.service_id = p_service_id);
END;
$$;
`;

export async function createClosedBetaGatesDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(readMigration(CLOSED_BETA_MIGRATION));
  return db;
}

export async function runSqlExpectError(
  db: PGlite,
  sql: string,
  params: unknown[] | undefined,
  pattern: RegExp,
): Promise<string> {
  try {
    if (params) {
      await db.query(sql, params);
    } else {
      await db.query(sql);
    }
    throw new Error(`expected SQL error matching ${pattern}, but statement succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("expected SQL error matching")) throw error;
    if (!pattern.test(message)) {
      throw new Error(`expected error matching ${pattern}, got: ${message}`);
    }
    return message;
  }
}

export async function seedCategoryService(
  db: PGlite,
  slug: string,
  serviceSlug: string,
): Promise<{ categoryId: string; serviceId: string }> {
  const category = await db.query<{ id: string }>(
    `INSERT INTO public.categories (slug) VALUES ($1) RETURNING id`,
    [slug],
  );
  const categoryId = category.rows[0]!.id;
  const service = await db.query<{ id: string }>(
    `
      INSERT INTO public.services (category_id, slug, name_en, name_ar)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [categoryId, serviceSlug, `${serviceSlug}-en`, `${serviceSlug}-ar`],
  );
  return { categoryId, serviceId: service.rows[0]!.id };
}

export async function seedEligibleProvider(
  db: PGlite,
  profileId: string,
  fullName: string,
  serviceIds: string | string[],
): Promise<string> {
  const services = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
  await db.query(`INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)`, [
    profileId,
    fullName,
  ]);
  const provider = await db.query<{ id: string }>(
    `
      INSERT INTO public.providers (profile_id)
      VALUES ($1)
      RETURNING id
    `,
    [profileId],
  );
  const providerId = provider.rows[0]!.id;
  for (const serviceId of services) {
    await db.query(
      `
        INSERT INTO public.provider_services (provider_id, service_id)
        VALUES ($1, $2)
      `,
      [providerId, serviceId],
    );
  }
  return providerId;
}
