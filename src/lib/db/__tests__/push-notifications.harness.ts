import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { queryRows } from "./monitoring-privilege-harness";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export const DEVICE_PUSH_MIGRATION = "20261021120000_device_push_tokens.sql";
export const OUTBOX_MIGRATION = "20260714235000_notification_outbox.sql";

export const IDS = {
  userA: "00000000-0000-0000-0000-0000000000a1",
  userB: "00000000-0000-0000-0000-0000000000b1",
};

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

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

INSERT INTO auth.users (id) VALUES
  ('${IDS.userA}'),
  ('${IDS.userB}')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  category text NOT NULL DEFAULT 'booking',
  title text NOT NULL DEFAULT 't',
  body text,
  title_en text,
  title_ar text,
  body_en text,
  body_ar text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deep_link text,
  campaign_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_push boolean NOT NULL DEFAULT true,
  chat_push boolean NOT NULL DEFAULT true,
  reminder_push boolean NOT NULL DEFAULT true,
  support_push boolean NOT NULL DEFAULT true,
  campaign_push boolean NOT NULL DEFAULT false
);
`;

export async function createPushDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(readMigration(DEVICE_PUSH_MIGRATION));
  await db.exec(readMigration(OUTBOX_MIGRATION));
  return db;
}

export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return fn();
}

export { queryRows };
