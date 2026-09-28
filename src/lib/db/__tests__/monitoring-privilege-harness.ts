import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export const ERROR_LOGS_MIGRATION = "20260824150000_error_logs_monitoring.sql";
export const RATE_LIMIT_MIGRATION = "20260827120000_error_log_client_rate_limits.sql";
export const HARDENING_MIGRATION = "20260928120000_monitoring_table_privilege_hardening.sql";

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

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_setting('test.admin_role', true), '') = 'on'
    AND _role = 'admin'
    AND _user_id IS NOT NULL;
$$;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
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

export async function functionExecuteAllowed(db: PGlite, grantee: string): Promise<boolean> {
  const rows = await queryRows<{ allowed: boolean }>(
    db,
    `
      SELECT has_function_privilege(
        $1,
        'public.error_log_client_rate_limit_allow(text, integer, integer)',
        'EXECUTE'
      ) AS allowed
    `,
    [grantee],
  );
  return Boolean(rows[0]?.allowed);
}

export async function rlsFlags(
  db: PGlite,
  tableName: string,
): Promise<{ relrowsecurity: boolean; relforcerowsecurity: boolean }> {
  const rows = await queryRows<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    db,
    `
      SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1
    `,
    [tableName],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`table ${tableName} not found`);
  }
  return row;
}

export async function errorLogsAdminPolicy(db: PGlite): Promise<{
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
}> {
  const rows = await queryRows<{
    policyname: string;
    cmd: string;
    roles: string[];
    qual: string | null;
  }>(
    db,
    `
      SELECT policyname, cmd, roles, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'error_logs'
        AND policyname = 'error_logs_admin_read'
    `,
  );
  const row = rows[0];
  if (!row) {
    throw new Error("error_logs_admin_read policy missing");
  }
  return row;
}

export async function seedErrorLog(db: PGlite, marker: string): Promise<void> {
  await db.query(
    `
      INSERT INTO public.error_logs (message_safe, source, context_label)
      VALUES ($1, 'server', 'privilege_hardening_test')
    `,
    [marker],
  );
}

export async function countErrorLogsAs(
  db: PGlite,
  role: "authenticated" | "anon" | "service_role",
  marker: string,
  options?: { admin?: boolean; userId?: string },
): Promise<{ count: number; error?: string }> {
  const userId = options?.userId ?? "00000000-0000-0000-0000-000000000001";
  try {
    await db.exec("BEGIN");
    if (options?.admin) {
      await db.exec("SELECT set_config('test.admin_role', 'on', true)");
    } else {
      await db.exec("SELECT set_config('test.admin_role', 'off', true)");
    }
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const rows = await queryRows<{ count: string }>(
      db,
      "SELECT count(*)::text AS count FROM public.error_logs WHERE message_safe = $1",
      [marker],
    );
    await db.exec("ROLLBACK");
    return { count: Number(rows[0]?.count ?? 0) };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { count: -1, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function insertErrorLogAs(
  db: PGlite,
  role: "authenticated" | "anon" | "service_role",
  marker: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.exec("BEGIN");
    await db.exec(`SET LOCAL ROLE ${role}`);
    await db.query(
      `
        INSERT INTO public.error_logs (message_safe, source)
        VALUES ($1, 'client')
      `,
      [marker],
    );
    await db.exec("ROLLBACK");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
