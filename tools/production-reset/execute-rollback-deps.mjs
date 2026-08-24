import { assertCountsUnchanged } from "./execute-sql.mjs";

/**
 * Default rollback verification deps for SQL simulation phases.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {{ phaseA: { truncateCascadeClosure: string[] } }} plan
 */
export function buildSqlRollbackDeps(admin, plan) {
  const tables = [...new Set([...plan.phaseA.truncateCascadeClosure, "audit_logs"])].sort();

  return {
    captureCounts: async () => {
      /** @type {Record<string, number>} */
      const counts = {};
      for (const table of tables) {
        const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
        if (error) throw new Error(`${table}: ${error.message}`);
        counts[table] = count ?? 0;
      }
      return counts;
    },
    verifyCounts: assertCountsUnchanged,
  };
}
