import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ACCOUNT_DELETION_MIGRATION = "20261021140000_account_deletion.sql";

export const IDS = {
  customer: "00000000-0000-0000-0000-000000000001",
  admin: "00000000-0000-0000-0000-000000000021",
  providerUser: "00000000-0000-0000-0000-000000000011",
  provider: "00000000-0000-0000-0000-000000000111",
  service: "00000000-0000-0000-0000-000000000311",
  address: "00000000-0000-0000-0000-000000000511",
  familyMember: "00000000-0000-0000-0000-000000000611",
};

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export function readMigration(fileName: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

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
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('customer', 'provider', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE public.booking_status AS ENUM (
      'pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
      'in_progress', 'completion_requested', 'completed', 'cancelled', 'no_show', 'disputed'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  phone text,
  email text,
  avatar_url text,
  locale text NOT NULL DEFAULT 'en',
  phone_verified boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  is_suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  bio_en text NOT NULL DEFAULT '',
  bio_ar text NOT NULL DEFAULT '',
  vacation_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY,
  name_en text NOT NULL DEFAULT 'service'
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  service_id uuid NOT NULL REFERENCES public.services(id),
  status public.booking_status NOT NULL DEFAULT 'pending',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.addresses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  full_name text NOT NULL DEFAULT 'child'
);

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios'
);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL DEFAULT 'k',
  auth_key text NOT NULL DEFAULT 'k'
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id),
  booking_push boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  type text NOT NULL DEFAULT 'id_card_front',
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  booking_id uuid,
  reason text,
  correlation_id uuid,
  old_values jsonb,
  new_values jsonb,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_guard_profile_admin_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.phone IS DISTINCT FROM OLD.phone OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified)
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND COALESCE(current_setting('famy.allow_phone_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Phone can only be changed through verification.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_admin_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_admin_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_profile_admin_fields();
`;

export async function createAccountDeletionDb() {
  const db = new PGlite();
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(readMigration(ACCOUNT_DELETION_MIGRATION));

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, phone, email, avatar_url, locale) VALUES
      ('${IDS.customer}', 'Customer One', '201012345678', 'c@example.com', 'user/avatar.jpg', 'en'),
      ('${IDS.admin}', 'Admin', '201012345679', 'a@example.com', NULL, 'en'),
      ('${IDS.providerUser}', 'Provider One', '201012345680', 'p@example.com', NULL, 'ar');
    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.customer}', 'customer'),
      ('${IDS.admin}', 'admin'),
      ('${IDS.providerUser}', 'provider');
    INSERT INTO public.providers (id, profile_id, bio_en, bio_ar) VALUES
      ('${IDS.provider}', '${IDS.providerUser}', 'bio', 'bio ar');
    INSERT INTO public.services (id) VALUES ('${IDS.service}');
    INSERT INTO public.addresses (id, user_id) VALUES ('${IDS.address}', '${IDS.customer}');
    INSERT INTO public.family_members (id, customer_id) VALUES ('${IDS.familyMember}', '${IDS.customer}');
    INSERT INTO public.device_push_tokens (id, user_id, token) VALUES ('00000000-0000-0000-0000-000000000701', '${IDS.customer}', 'tok');
    INSERT INTO public.push_subscriptions (id, user_id, endpoint) VALUES ('00000000-0000-0000-0000-000000000702', '${IDS.customer}', 'https://push.example/1');
    INSERT INTO public.notification_preferences (user_id) VALUES ('${IDS.customer}');
    INSERT INTO public.provider_documents (provider_id, storage_path) VALUES ('${IDS.provider}', 'docs/id.jpg');
  `);

  return db;
}

export async function queryRows<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
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

export async function asServiceRole<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE service_role`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}
