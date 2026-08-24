import spawn from "cross-spawn";

/**
 * @param {string} databaseUrl
 * @param {string} sql
 */
export function defaultExecSql(databaseUrl, sql) {
  const result = spawn.sync("npx", ["supabase", "db", "query", "--db-url", databaseUrl, sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      detail || `[production-reset:execute:simulate] supabase db query exited with status ${result.status}`,
    );
  }
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
  let dataUnchangedVerified = false;
  if (beforeCounts && afterCounts) {
    if (deps.verifyCounts) {
      deps.verifyCounts(beforeCounts, afterCounts);
    } else {
      assertCountsUnchanged(beforeCounts, afterCounts);
    }
    dataUnchangedVerified = true;
  }

  return {
    mode: "rollback-transaction",
    statements,
    rolledBack: true,
    dataUnchangedVerified,
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
