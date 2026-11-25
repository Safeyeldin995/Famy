import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applySql, createDisposableDb, readMigration } from "./monitoring-privilege-harness";

let db: PGlite;

async function asRole<T>(role: "anon" | "authenticated", fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  db = await createDisposableDb();
  // Same policies as Production: anyone reads settings, only admins write.
  await applySql(
    db,
    `
    CREATE TABLE IF NOT EXISTS public.settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
    ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.settings TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
    CREATE POLICY settings_public_read ON public.settings FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY settings_admin_write ON public.settings FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  `,
  );
  await applySql(db, readMigration("20261125120000_app_release_gate.sql"));
});

afterAll(async () => {
  await db.close();
});

describe("settings.app_release", () => {
  it("is seeded with safe defaults and is readable by anon", async () => {
    const rows = await asRole("anon", () =>
      db.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM public.settings WHERE key = 'app_release'`,
      ),
    );
    expect(rows.rows[0]?.value).toMatchObject({ min_version_android: "1.0.0", maintenance: false });
  });

  it("is idempotent and never overwrites an existing value", async () => {
    await db.exec(
      `UPDATE public.settings SET value = jsonb_set(value, '{maintenance}', 'true') WHERE key = 'app_release'`,
    );
    await applySql(db, readMigration("20261125120000_app_release_gate.sql"));
    const rows = await db.query<{ m: boolean }>(
      `SELECT (value->>'maintenance')::boolean AS m FROM public.settings WHERE key = 'app_release'`,
    );
    expect(rows.rows[0]?.m).toBe(true);
    await db.exec(
      `UPDATE public.settings SET value = jsonb_set(value, '{maintenance}', 'false') WHERE key = 'app_release'`,
    );
  });

  it("cannot be written by anon or a non-admin user", async () => {
    await expect(
      asRole("anon", () =>
        db.exec(
          `UPDATE public.settings SET value = jsonb_set(value, '{maintenance}', 'true') WHERE key = 'app_release'`,
        ),
      ),
    ).rejects.toThrow();

    await db.query(
      "SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false)",
    );
    await db.query("SELECT set_config('test.admin_role', 'off', false)");
    await asRole("authenticated", () =>
      db.exec(
        `UPDATE public.settings SET value = jsonb_set(value, '{maintenance}', 'true') WHERE key = 'app_release'`,
      ),
    );
    const rows = await db.query<{ m: boolean }>(
      `SELECT (value->>'maintenance')::boolean AS m FROM public.settings WHERE key = 'app_release'`,
    );
    expect(rows.rows[0]?.m).toBe(false);
  });

  it("rejects malformed versions so a typo cannot lock users out", async () => {
    await expect(
      db.exec(
        `UPDATE public.settings SET value = jsonb_set(value, '{min_version_android}', '"9"') WHERE key = 'app_release'`,
      ),
    ).rejects.toThrow(/APP_RELEASE_INVALID/);
    await expect(
      db.exec(
        `UPDATE public.settings SET value = jsonb_set(value, '{maintenance}', '"yes"') WHERE key = 'app_release'`,
      ),
    ).rejects.toThrow(/APP_RELEASE_INVALID/);
  });

  it("leaves other settings keys alone", async () => {
    await db.exec(`INSERT INTO public.settings (key, value) VALUES ('other', '{"a": 1}'::jsonb)`);
    const rows = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.settings WHERE key = 'other'`,
    );
    expect(rows.rows[0]?.n).toBe(1);
  });
});
