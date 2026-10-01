import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

export const EXPIRY_MIGRATION = "20261001140000_expire_pending_bookings.sql";

export const IDS = {
  customer: "00000000-0000-0000-0000-000000000001",
  providerUser: "00000000-0000-0000-0000-000000000011",
  provider: "00000000-0000-0000-0000-000000000111",
  service: "00000000-0000-0000-0000-000000000311",
  address: "00000000-0000-0000-0000-000000000511",
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

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text
);

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  min_notice_hours integer NOT NULL DEFAULT 4
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY,
  name_en text NOT NULL DEFAULT 'service'
);

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cancellation_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  actor_type text NOT NULL DEFAULT 'admin',
  requires_note boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE public.booking_status AS ENUM (
      'pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
      'in_progress', 'completion_requested', 'completed', 'cancelled', 'no_show', 'disputed'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM (
      'pending', 'pending_review', 'authorized', 'captured', 'rejected', 'failed', 'refunded', 'partially_refunded'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  service_id uuid NOT NULL,
  address_id uuid,
  family_member_id uuid,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  notes text,
  requirement_selections jsonb DEFAULT '[]'::jsonb,
  promo_code_id uuid,
  price_subtotal numeric NOT NULL DEFAULT 0,
  price_discount numeric NOT NULL DEFAULT 0,
  price_total numeric NOT NULL DEFAULT 0,
  price_platform_fee numeric NOT NULL DEFAULT 0,
  price_vat numeric NOT NULL DEFAULT 0,
  price_extras_total numeric NOT NULL DEFAULT 0,
  price_travel_fee numeric NOT NULL DEFAULT 0,
  idempotency_key uuid,
  request_fingerprint text,
  currency text NOT NULL DEFAULT 'EGP',
  teaching_capability_id uuid,
  teaching_subject_code text,
  teaching_curriculum_code text,
  teaching_level_code text,
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot
  ON public.bookings (provider_id, start_at, end_at)
  WHERE status IN (
    'pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
    'in_progress', 'completion_requested'
  );

CREATE TABLE IF NOT EXISTS public.booking_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  from_status public.booking_status,
  to_status public.booking_status NOT NULL,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_booking_status_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.booking_status_history(booking_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_booking_status_audit ON public.bookings;
CREATE TRIGGER trg_booking_status_audit AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_status_audit();

CREATE OR REPLACE FUNCTION public.tg_validate_booking_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'cancelled'
     AND OLD.status IN ('pending', 'confirmed')
     AND current_setting('app.cancellation_in_progress', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Bookings can only be cancelled through the cancel_booking function.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_booking_transition_guard ON public.bookings;
CREATE TRIGGER trg_booking_transition_guard
BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_transition();

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending',
  method text NOT NULL DEFAULT 'paymob',
  amount numeric(10,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  category text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text,
  title_en text,
  title_ar text,
  body_en text,
  body_ar text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deep_link text,
  booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
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
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  body text,
  system_key text
);

CREATE OR REPLACE FUNCTION public.is_not_suspended(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true; $$;

DROP FUNCTION IF EXISTS public.booking_request_fingerprint(uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.booking_request_fingerprint(
  p_provider_id uuid, p_service_id uuid, p_address_id uuid,
  p_start_at timestamptz, p_end_at timestamptz,
  p_family_member_id uuid, p_notes text, p_promo_code_id uuid, p_requirement_selections jsonb,
  p_teaching_capability_id uuid DEFAULT NULL,
  p_teaching_subject_code text DEFAULT NULL,
  p_teaching_curriculum_code text DEFAULT NULL,
  p_teaching_level_code text DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|',
    p_provider_id::text, p_service_id::text, p_address_id::text,
    p_start_at::text, p_end_at::text, coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''), coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]'),
    coalesce(p_teaching_capability_id::text, ''),
    coalesce(p_teaching_subject_code, ''),
    coalesce(p_teaching_curriculum_code, ''),
    coalesce(p_teaching_level_code, '')
  );
$$;

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid, p_address_id uuid
) RETURNS TABLE (is_eligible boolean)
LANGUAGE sql STABLE AS $$
  SELECT true;
$$;
`;

export async function queryRows<T extends Record<string, unknown>>(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = params ? await db.query<T>(sql, params) : await db.query<T>(sql);
  return result.rows;
}

export async function runSqlExpectError(
  db: PGlite,
  sql: string,
  params: unknown[] | undefined,
  pattern: RegExp,
): Promise<string> {
  try {
    if (params) await db.query(sql, params);
    else await db.query(sql);
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

export async function createExpiryDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(readMigration(EXPIRY_MIGRATION));
  await db.query(
    `INSERT INTO public.profiles (id, full_name) VALUES ($1, 'Customer'), ($2, 'Provider')`,
    [IDS.customer, IDS.providerUser],
  );
  await db.query(
    `INSERT INTO public.providers (id, profile_id, min_notice_hours) VALUES ($1, $2, 4)`,
    [IDS.provider, IDS.providerUser],
  );
  await db.query(`INSERT INTO public.services (id, name_en) VALUES ($1, 'Babysitting')`, [
    IDS.service,
  ]);
  return db;
}

export async function insertPendingBooking(
  db: PGlite,
  args: {
    createdAt: string;
    startAt: string;
    endAt?: string;
    status?: string;
    id?: string;
  },
): Promise<string> {
  const endAt =
    args.endAt ?? new Date(new Date(args.startAt).getTime() + 2 * 3600000).toISOString();
  const result = await db.query<{ id: string }>(
    `
      INSERT INTO public.bookings (
        id, customer_id, provider_id, service_id, address_id,
        start_at, end_at, status, created_at
      ) VALUES (
        coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5,
        $6::timestamptz, $7::timestamptz, $8::public.booking_status, $9::timestamptz
      )
      RETURNING id
    `,
    [
      args.id ?? null,
      IDS.customer,
      IDS.provider,
      IDS.service,
      IDS.address,
      args.startAt,
      endAt,
      args.status ?? "pending",
      args.createdAt,
    ],
  );
  return result.rows[0]!.id;
}

export async function functionExecuteAllowed(
  db: PGlite,
  grantee: string,
  signature = "public.expire_pending_bookings()",
): Promise<boolean> {
  const rows = await queryRows<{ allowed: boolean }>(
    db,
    `SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed`,
    [grantee, signature],
  );
  return Boolean(rows[0]?.allowed);
}
