import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createMigrationReplayDb,
  readMigrationFile,
  replayAllMigrations,
} from "./migration-replay.harness";
import { functionExecuteAllowed } from "./babysitting-capabilities-harness";

const ADVISOR_MIGRATION = "20261027120000_supabase_security_advisor_remediation.sql";

const admin = "00000000-0000-0000-0000-000000001901";
const customer = "00000000-0000-0000-0000-000000001902";

let db: PGlite;

beforeAll(async () => {
  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
  await db.exec(readMigrationFile(ADVISOR_MIGRATION));
  await db.exec(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb",
  );
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${admin}'), ('${customer}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES ('${admin}', 'admin')
    ON CONFLICT DO NOTHING;
  `);
}, 120000);

afterAll(async () => {
  await db?.close();
});

async function tryRpcAs(
  userId: string,
  sql: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.exec("BEGIN");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.aal', 'aal2', true)", []);
    await db.exec("SET LOCAL ROLE authenticated");
    await db.query(sql);
    await db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

describe("supabase security advisor remediation", () => {
  it("denies anon EXECUTE on trigger helper tg_validate_zone_polygon", async () => {
    expect(
      await functionExecuteAllowed(db, "anon", "public.tg_validate_zone_polygon()"),
    ).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "authenticated",
        "public.tg_validate_zone_polygon()",
      ),
    ).toBe(false);
  });

  it("still allows anon EXECUTE on resolve_zone for public service-area lookup", async () => {
    expect(
      await functionExecuteAllowed(
        db,
        "anon",
        "public.resolve_zone(double precision, double precision)",
      ),
    ).toBe(true);
  });

  it("rejects admin_work_queue_counts for a non-admin authenticated user", async () => {
    const result = await tryRpcAs(customer, "SELECT * FROM public.admin_work_queue_counts()");
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/Admin authorization required|42501/);
  });

  it("rejects check_zone_overlap for a non-admin authenticated user", async () => {
    const result = await tryRpcAs(
      customer,
      "SELECT * FROM public.check_zone_overlap('[]'::jsonb, NULL::uuid)",
    );
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/Admin authorization required|42501/);
  });
});
