import { describe, expect, it } from "vitest";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

/**
 * Guard for #443/#444: internal money and lifecycle SECURITY DEFINER helpers
 * must never be executable by end users. Supabase grants EXECUTE on new
 * public functions to anon/authenticated by default, so the replay emulates
 * that default before applying every migration.
 */
const INTERNAL_NAME = "(^(credit_|restore_|reconcile_|settle_|expire_|apply_livekit)|_internal$)";

// Functions the app legitimately calls as an end user. Add an entry only after
// confirming a real `.rpc("<name>")` call in src/ or mobile/src/, with a reason.
const AUTHENTICATED_ALLOWLIST: string[] = [];

describe("internal SECURITY DEFINER functions", () => {
  it("are not executable by authenticated or anon", async () => {
    const db = await createMigrationReplayDb();
    await db.exec(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role",
    );
    await replayAllMigrations(db);

    const { rows } = await db.query<{ sig: string; auth: boolean; anon: boolean }>(
      `SELECT p.oid::regprocedure::text AS sig,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND p.proname ~ $1
        ORDER BY 1`,
      [INTERNAL_NAME],
    );

    // Sanity: the pattern must still match the known internal helpers.
    expect(rows.map((r) => r.sig)).toEqual(
      expect.arrayContaining([
        "credit_customer_wallet_customer_cancelled(uuid)",
        "restore_customer_wallet_checkout_debit(uuid)",
      ]),
    );

    const exposed = rows
      .filter((r) => (r.auth || r.anon) && !AUTHENTICATED_ALLOWLIST.includes(r.sig))
      .map((r) => r.sig);
    expect(exposed).toEqual([]);
  }, 300_000);
});
