import { execSync } from "node:child_process";

/**
 * @param {string} databaseUrl
 * @param {string} sql
 */
export function defaultExecSql(databaseUrl, sql) {
  execSync(`npx supabase db query --db-url ${JSON.stringify(databaseUrl)} ${JSON.stringify(sql)}`, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Run SQL statements inside a transaction that always rolls back (simulation).
 *
 * @param {string | null | undefined} databaseUrl
 * @param {string[]} statements
 * @param {{ execSql?: (databaseUrl: string, sql: string) => void; captureCounts?: () => Promise<Record<string, number>>; verifyCounts?: (before: Record<string, number>, after: Record<string, number>) => void }} [deps]
 */
export async function runSimulatedSqlTransaction(databaseUrl, statements, deps = {}) {
  const execSql = deps.execSql ?? defaultExecSql;

  if (!databaseUrl) {
    return {
      mode: "plan-only",
      statements,
      rolledBack: null,
      dataUnchangedVerified: false,
    };
  }

  const beforeCounts = deps.captureCounts ? await deps.captureCounts() : null;
  const wrapped = ["BEGIN", ...statements, "ROLLBACK"].join(";\n") + ";";
  execSql(databaseUrl, wrapped);

  const afterCounts = deps.captureCounts ? await deps.captureCounts() : null;
  if (beforeCounts && afterCounts && deps.verifyCounts) {
    deps.verifyCounts(beforeCounts, afterCounts);
  } else if (beforeCounts && afterCounts) {
    assertCountsUnchanged(beforeCounts, afterCounts);
  }

  return {
    mode: "rollback-transaction",
    statements,
    rolledBack: true,
    dataUnchangedVerified: Boolean(beforeCounts && afterCounts),
  };
}

/**
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 */
export function assertCountsUnchanged(before, after) {
  for (const [table, count] of Object.entries(before)) {
    if ((after[table] ?? 0) !== count) {
      throw new Error(
        `[production-reset:execute:simulate] Rollback verification failed for ${table}: before=${count}, after=${after[table] ?? 0}`,
      );
    }
  }
}
