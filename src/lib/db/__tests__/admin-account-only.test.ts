import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

const adminId = "00000000-0000-0000-0000-00000000b901";
const customerId = "00000000-0000-0000-0000-00000000b902";
const providerUserId = "00000000-0000-0000-0000-00000000b903";

let db: PGlite;

beforeAll(async () => {
  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb;
    INSERT INTO auth.users(id, raw_user_meta_data) VALUES
      ('${adminId}', '{}'::jsonb),
      ('${customerId}', '{"signup_role":"customer"}'::jsonb),
      ('${providerUserId}', '{"signup_role":"provider"}'::jsonb);
    DELETE FROM public.user_roles WHERE user_id IN ('${adminId}', '${customerId}', '${providerUserId}');
    INSERT INTO public.user_roles(user_id, role) VALUES
      ('${adminId}', 'admin'),
      ('${customerId}', 'customer'),
      ('${providerUserId}', 'provider');
    UPDATE public.profiles SET phone = '+201000000901' WHERE id = '${adminId}';
    UPDATE public.profiles SET phone = '+201000000902' WHERE id = '${customerId}';
    UPDATE public.profiles SET phone = '+201000000903' WHERE id = '${providerUserId}';
  `);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function expectAdminRestricted(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    message: expect.stringMatching(/admin_account_restricted/i),
  });
}

describe("admin account database guards", () => {
  it("is_admin_account reflects the admin role", async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      "SELECT public.is_admin_account($1::uuid) AS ok",
      [adminId],
    );
    expect(rows[0]?.ok).toBe(true);
    const other = await db.query<{ ok: boolean }>(
      "SELECT public.is_admin_account($1::uuid) AS ok",
      [customerId],
    );
    expect(other.rows[0]?.ok).toBe(false);
  });

  it("rejects provider rows tied to an admin profile", async () => {
    await expectAdminRestricted(
      db.query(
        `INSERT INTO public.providers (
          profile_id, bio_en, bio_ar, years_experience, hourly_rate, city, country, languages
        ) VALUES ($1, '', '', 1, 100, 'Cairo', 'EG', ARRAY[]::text[])`,
        [adminId],
      ),
    );
  });

  it("rejects assigning customer or provider roles to an admin account", async () => {
    await expectAdminRestricted(
      db.query(`INSERT INTO public.user_roles(user_id, role) VALUES ($1, 'customer')`, [adminId]),
    );
    await expectAdminRestricted(
      db.query(`INSERT INTO public.user_roles(user_id, role) VALUES ($1, 'provider')`, [adminId]),
    );
  });

  it("rejects granting admin to a user who already has a provider row", async () => {
    await db.query(
      `INSERT INTO public.providers (
        profile_id, bio_en, bio_ar, years_experience, hourly_rate, city, country, languages
      ) VALUES ($1, '', '', 2, 120, 'Cairo', 'EG', ARRAY[]::text[])`,
      [providerUserId],
    );
    await expectAdminRestricted(
      db.query(`INSERT INTO public.user_roles(user_id, role) VALUES ($1, 'admin')`, [
        providerUserId,
      ]),
    );
  });

  it("blocks admin accounts in raise_if_admin_account", async () => {
    await expectAdminRestricted(
      db.query(`SELECT public.raise_if_admin_account($1::uuid)`, [adminId]),
    );
  });
});
