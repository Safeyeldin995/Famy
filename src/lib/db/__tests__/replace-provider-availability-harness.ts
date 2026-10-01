import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export const REPLACE_AVAILABILITY_MIGRATION = "20261001120000_replace_provider_availability.sql";

export const FUNCTION_SIGNATURE = "public.replace_provider_availability(uuid, jsonb)";

export const IDS = {
  providerUser: "00000000-0000-0000-0000-000000000011",
  otherProviderUser: "00000000-0000-0000-0000-000000000012",
  adminUser: "00000000-0000-0000-0000-000000000021",
  provider: "00000000-0000-0000-0000-000000000111",
  otherProvider: "00000000-0000-0000-0000-000000000112",
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
END
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

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id)
);

GRANT SELECT, UPDATE ON public.providers TO authenticated;

CREATE TABLE IF NOT EXISTS public.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.availability_rules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.availability_rules TO authenticated;
GRANT ALL ON public.availability_rules TO service_role;

ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "avail_public_read" ON public.availability_rules
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "avail_self_manage" ON public.availability_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.providers p WHERE p.id = provider_id AND p.profile_id = auth.uid()));

CREATE POLICY "avail_admin_all" ON public.availability_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
`;

export function readMigration(fileName: string = REPLACE_AVAILABILITY_MIGRATION): string {
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
  await db.exec(readMigration());
  return db;
}

export async function seedIdentities(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO public.profiles (id, full_name) VALUES
      ('${IDS.providerUser}', 'Provider'),
      ('${IDS.otherProviderUser}', 'Other Provider'),
      ('${IDS.adminUser}', 'Admin');

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.providerUser}', 'provider'),
      ('${IDS.otherProviderUser}', 'provider'),
      ('${IDS.adminUser}', 'customer'),
      ('${IDS.adminUser}', 'admin');

    INSERT INTO public.providers (id, profile_id) VALUES
      ('${IDS.provider}', '${IDS.providerUser}'),
      ('${IDS.otherProvider}', '${IDS.otherProviderUser}');
  `);
}

export async function seedRule(
  db: PGlite,
  providerId: string,
  weekday: number,
  startTime: string,
  endTime: string,
): Promise<void> {
  await db.query(
    `
      INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time, timezone)
      VALUES ($1, $2, $3::time, $4::time, 'Africa/Cairo')
    `,
    [providerId, weekday, startTime, endTime],
  );
}

export async function listRules(
  db: PGlite,
  providerId: string,
): Promise<{ weekday: number; start_time: string; end_time: string; timezone: string }[]> {
  return queryRows(
    db,
    `
      SELECT weekday::int AS weekday, start_time::text, end_time::text, timezone
      FROM public.availability_rules
      WHERE provider_id = $1
      ORDER BY weekday, start_time
    `,
    [providerId],
  );
}

export async function asRole<T>(
  db: PGlite,
  role: "authenticated" | "anon",
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec("BEGIN");
  try {
    if (userId) {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    } else {
      await db.exec("SELECT set_config('request.jwt.claim.sub', '', true)");
    }
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function tryReplace(
  db: PGlite,
  args: {
    role: "authenticated" | "anon";
    userId: string | null;
    providerId: string;
    rules: unknown;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await asRole(db, args.role, args.userId, async () => {
      await db.query(`SELECT public.replace_provider_availability($1::uuid, $2::jsonb)`, [
        args.providerId,
        JSON.stringify(args.rules),
      ]);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function functionExecuteAllowed(db: PGlite, grantee: string): Promise<boolean> {
  const rows = await queryRows<{ allowed: boolean }>(
    db,
    `SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed`,
    [grantee, FUNCTION_SIGNATURE],
  );
  return Boolean(rows[0]?.allowed);
}

export async function functionIsSecurityInvoker(db: PGlite): Promise<boolean> {
  const rows = await queryRows<{ prosecdef: boolean }>(
    db,
    `
      SELECT p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'replace_provider_availability'
    `,
  );
  return rows[0]?.prosecdef === false;
}
