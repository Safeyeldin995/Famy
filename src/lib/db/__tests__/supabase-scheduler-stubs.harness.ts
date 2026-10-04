import { PGlite } from "@electric-sql/pglite";

/** PGlite stubs for pg_cron, pg_net, and Vault (used by migration replay tests). */
export const SCHEDULER_STUBS_SQL = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid serial PRIMARY KEY,
  jobname name UNIQUE,
  schedule text,
  command text,
  nodename text DEFAULT 'localhost',
  nodeport int DEFAULT 5432,
  database text DEFAULT current_database(),
  username text DEFAULT current_user,
  active boolean DEFAULT true
);

CREATE OR REPLACE FUNCTION cron.schedule(job_name name, cron_schedule text, command text)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (job_name, cron_schedule, command)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule, command = EXCLUDED.command;
  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name name)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN true;
END;
$$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_journal (
  id serial PRIMARY KEY,
  url text NOT NULL,
  headers text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO net._http_journal (url, headers) VALUES (url, headers::text);
  RETURN 1;
END;
$$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  secret text NOT NULL
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, secret AS decrypted_secret FROM vault.secrets;

INSERT INTO pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT 99998, 'pg_cron', 10, (SELECT oid FROM pg_namespace WHERE nspname = 'pg_catalog'), false, '1.0'
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');

INSERT INTO pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT 99997, 'pg_net', 10, (SELECT oid FROM pg_namespace WHERE nspname = 'pg_catalog'), false, '0.1'
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net');

INSERT INTO pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
SELECT 99996, 'btree_gist', 10, (SELECT oid FROM pg_namespace WHERE nspname = 'pg_catalog'), false, '1.0'
WHERE NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist');
`;

export async function applySchedulerStubs(db: PGlite): Promise<void> {
  await db.exec(SCHEDULER_STUBS_SQL);
}
