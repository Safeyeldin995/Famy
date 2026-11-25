import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

const adminId = "00000000-0000-0000-0000-00000000b901";
const customerId = "00000000-0000-0000-0000-00000000b902";
const providerUserId = "00000000-0000-0000-0000-00000000b903";
const identityRaceUserId = "00000000-0000-0000-0000-00000000b904";

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

async function asAuthenticated<T>(userId: string, run: () => Promise<T>): Promise<T> {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', false)");
  return run();
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

  it("blocks provider row creation in the same transaction after an admin grant", async () => {
    await db.exec(`
      INSERT INTO auth.users (id, raw_user_meta_data) VALUES
        ('${identityRaceUserId}', '{"signup_role":"provider"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.exec("BEGIN");
    try {
      await db.query(`DELETE FROM public.user_roles WHERE user_id = $1::uuid`, [identityRaceUserId]);
      await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [
        identityRaceUserId,
      ]);
      await expectAdminRestricted(
        db.query(
          `INSERT INTO public.providers (
          profile_id, bio_en, bio_ar, years_experience, hourly_rate, city, country, languages
        ) VALUES ($1, '', '', 1, 100, 'Cairo', 'EG', ARRAY[]::text[])`,
          [identityRaceUserId],
        ),
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("rejects provider profile updates that target an admin account", async () => {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM public.providers WHERE profile_id = $1",
      [providerUserId],
    );
    const providerId = rows[0]?.id;
    expect(providerId).toBeTruthy();
    await expectAdminRestricted(
      db.query(`UPDATE public.providers SET profile_id = $1 WHERE id = $2`, [adminId, providerId]),
    );
  });

  it("rejects provider_save_onboarding_section for admin-only accounts", async () => {
    await expect(
      asAuthenticated(adminId, () =>
        db.query(`SELECT public.provider_save_onboarding_section('identity', '{}'::jsonb)`),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/admin_account_restricted/i),
    });
  });
});
