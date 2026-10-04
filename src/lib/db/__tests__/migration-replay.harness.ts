import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { applySchedulerStubs } from "./supabase-scheduler-stubs.harness";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const REPLAY_BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE OR REPLACE FUNCTION extensions.digest(data text, type text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(md5(data), 'hex');
$$;

CREATE OR REPLACE FUNCTION extensions.crypt(data text, salt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(data || salt);
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_to_array(name, '/');
$$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

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
`;

/** Strip PGlite-incompatible bits so the full migrations folder can replay in tests. */
export function sanitizeMigrationForPglite(sql: string): string {
  let out = sql;
  out = out.replace(
    /CREATE EXTENSION IF NOT EXISTS btree_gist;\s*/gi,
    "-- pglite: btree_gist unavailable\n",
  );
  out = out.replace(
    /CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/gi,
    "-- pglite: pgcrypto unavailable\n",
  );
  out = out.replace(
    /ALTER EXTENSION btree_gist SET SCHEMA extensions;\s*/gi,
    "-- pglite: btree_gist schema move skipped\n",
  );
  out = out.replace(
    /,\s*-- prevent overlapping active bookings per provider\s*CONSTRAINT bookings_no_overlap EXCLUDE USING gist \([\s\S]*?\)\s*WHERE \(status IN \([^)]+\)\)/gi,
    "\n  -- pglite: bookings_no_overlap exclude omitted",
  );
  out = out.replace(
    /ALTER TABLE public\.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist \([\s\S]*?\);/gi,
    "-- pglite: bookings_no_overlap alter exclude omitted",
  );
  out = out.replace(
    /EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';/g,
    "PERFORM 1; -- pglite: pg_cron pre-stubbed",
  );
  out = out.replace(
    /EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';/g,
    "PERFORM 1; -- pglite: pg_net pre-stubbed",
  );
  return out;
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export function readMigrationFile(fileName: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

export async function createMigrationReplayDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(REPLAY_BOOTSTRAP_SQL);
  await applySchedulerStubs(db);
  return db;
}

export async function replayAllMigrations(db: PGlite): Promise<void> {
  for (const file of listMigrationFiles()) {
    const sql = sanitizeMigrationForPglite(readMigrationFile(file));
    await db.exec(sql);
  }
}
