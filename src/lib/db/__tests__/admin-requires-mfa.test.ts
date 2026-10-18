import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

const admin = "00000000-0000-0000-0000-000000001901";
const customer = "00000000-0000-0000-0000-000000001902";

let db: PGlite;

beforeAll(async () => {
  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${admin}'), ('${customer}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${admin}', 'admin');
  `);
}, 60000);

afterAll(async () => {
  await db?.close();
});

async function hasRole(caller: string, target: string, role: string, aal: string) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [caller]);
  await db.query("SELECT set_config('request.jwt.claim.aal', $1, false)", [aal]);
  const { rows } = await db.query<{ ok: boolean }>(
    "SELECT public.has_role($1::uuid, $2::app_role) AS ok",
    [target, role],
  );
  return rows[0].ok;
}

describe("admin role requires a second factor (aal2)", () => {
  it("denies admin to the admin's own aal1 session", async () => {
    expect(await hasRole(admin, admin, "admin", "aal1")).toBe(false);
    expect(await hasRole(admin, admin, "admin", "")).toBe(false);
  });

  it("allows admin once the session is aal2", async () => {
    expect(await hasRole(admin, admin, "admin", "aal2")).toBe(true);
  });

  it("does not affect other roles at aal1", async () => {
    expect(await hasRole(customer, customer, "customer", "aal1")).toBe(true);
  });

  it("keeps the meaning of checks about another user", async () => {
    expect(await hasRole(customer, admin, "admin", "aal1")).toBe(true);
    expect(await hasRole(admin, customer, "admin", "aal2")).toBe(false);
  });

  it("reads aal from the JSON claims too (production PostgREST)", async () => {
    await db.query("SELECT set_config('request.jwt.claim.aal', '', false)");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin]);
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: admin, aal: "aal2" }),
    ]);
    const { rows } = await db.query<{ ok: boolean }>(
      "SELECT public.has_role($1::uuid, 'admin') AS ok",
      [admin],
    );
    expect(rows[0].ok).toBe(true);
    await db.query("SELECT set_config('request.jwt.claims', '', false)");
  });
});
