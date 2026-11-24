import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applySql, createDisposableDb, readMigration } from "./monitoring-privilege-harness";

let db: PGlite;

beforeAll(async () => {
  db = await createDisposableDb();
  await applySql(
    db,
    `
    CREATE TABLE IF NOT EXISTS public.settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated, service_role;
  `,
  );
  await applySql(db, readMigration("20261124120000_release_quality_gate.sql"));
});

afterAll(async () => {
  await db.close();
});

describe("release_features", () => {
  it("defaults online lessons to disabled", async () => {
    const row = await db.query<{ on: boolean }>(
      `SELECT public.online_lessons_enabled() AS on`,
    );
    expect(row.rows[0]?.on).toBe(false);
  });

  it("reflects admin settings updates", async () => {
    await db.exec(`
      UPDATE public.settings
      SET value = '{"online_lessons_enabled": true}'::jsonb
      WHERE key = 'release_features';
    `);
    const row = await db.query<{ on: boolean }>(
      `SELECT public.online_lessons_enabled() AS on`,
    );
    expect(row.rows[0]?.on).toBe(true);
  });
});