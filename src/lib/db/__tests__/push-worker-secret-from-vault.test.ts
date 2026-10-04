import { describe, expect, it } from "vitest";
import {
  applySql,
  createDisposableDb,
  queryRows,
  readMigration,
} from "./monitoring-privilege-harness";
import { applySchedulerStubs } from "./supabase-scheduler-stubs.harness";

const MIGRATION = "20261004120000_push_worker_secret_from_vault.sql";
const FN = "public.get_notification_worker_secret()";

describe("push worker Vault secret RPC", () => {
  it("is stable, security-definer, idempotent, and executable only by service_role", async () => {
    const db = await createDisposableDb();
    try {
      await applySchedulerStubs(db);
      await applySql(db, readMigration(MIGRATION));
      await applySql(db, readMigration(MIGRATION));

      const functions = await queryRows<{
        stable: boolean;
        security_definer: boolean;
        config: string[];
      }>(
        db,
        `SELECT provolatile = 's' AS stable, prosecdef AS security_definer, proconfig AS config
         FROM pg_proc WHERE oid = $1::regprocedure`,
        [FN],
      );
      expect(functions).toEqual([
        { stable: true, security_definer: true, config: ["search_path=public"] },
      ]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const rows = await queryRows<{ allowed: boolean }>(
          db,
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed`,
          [role, FN],
        );
        expect(rows[0]?.allowed).toBe(role === "service_role");
      }
      const publicGrants = await queryRows<{ granted: boolean }>(
        db,
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
           WHERE p.oid = $1::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
         ) AS granted`,
        [FN],
      );
      expect(publicGrants[0]?.granted).toBe(false);

      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        try {
          await expect(db.query(`SELECT ${FN}`)).rejects.toThrow(/permission denied/);
        } finally {
          await db.exec("RESET ROLE");
        }
      }
      await db.query(`INSERT INTO vault.secrets (name, secret) VALUES ($1, $2), ($3, $4)`, [
        "unrelated_test_entry",
        "synthetic-unrelated-value",
        "notification_worker_secret",
        "synthetic-worker-value",
      ]);
      await db.exec("SET ROLE service_role");
      try {
        const rows = await queryRows<{ matches: boolean }>(db, `SELECT ${FN} = $1 AS matches`, [
          "synthetic-worker-value",
        ]);
        expect(rows[0]?.matches).toBe(true);
      } finally {
        await db.exec("RESET ROLE");
      }
      await db.query(`DELETE FROM vault.secrets WHERE name = $1`, ["notification_worker_secret"]);
      const missing = await queryRows<{ missing: boolean }>(db, `SELECT ${FN} IS NULL AS missing`);
      expect(missing[0]?.missing).toBe(true);
    } finally {
      await db.close();
    }
  });
});
