import { describe, expect, it } from "vitest";
import { createMigrationReplayDb, replayAllMigrations } from "./migration-replay.harness";

describe("parent link hardening (20261126090000)", () => {
  it("locks the email send log and the unused helper away from end users", async () => {
    const db = await createMigrationReplayDb();
    // Supabase grants EXECUTE on new public functions to anon/authenticated by default.
    await db.exec(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role",
    );
    await replayAllMigrations(db);

    const rls = await db.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'parent_guardian_email_sends'`,
    );
    expect(rls.rows).toEqual([{ relrowsecurity: true }]);

    const policies = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'parent_guardian_email_sends'`,
    );
    expect(policies.rows[0].n).toBe(0);

    const grants = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(
      `SELECT has_function_privilege('anon', 'public.student_has_linked_parent(uuid)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.student_has_linked_parent(uuid)', 'EXECUTE') AS auth,
              has_function_privilege('service_role', 'public.student_has_linked_parent(uuid)', 'EXECUTE') AS service`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, auth: false, service: true });

    // Parent auto-link only trusts OTP-verified phones.
    const resolve = await db.query<{ src: string; auth: boolean }>(
      `SELECT p.prosrc AS src,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = '_student_parent_link_resolve_parent'`,
    );
    expect(resolve.rows).toHaveLength(1);
    expect(resolve.rows[0].src).toContain("pr.phone_verified");
    expect(resolve.rows[0].auth).toBe(false);

    await db.close();
  }, 180_000);
});
