/**
 * Detect top-level transaction control via PostgreSQL libpg_query (libpg-query).
 * Used by Production db-migrate workflow — embedded BEGIN/COMMIT breaks outer transactions.
 */
import { loadModule, parseSync, SqlError } from "libpg-query";

let parserReady = null;

/** @returns {Promise<void>} */
export async function initMigrationParser() {
  if (!parserReady) {
    parserReady = loadModule();
  }
  await parserReady;
}

/**
 * @typedef {{ kind: 'parse_error'; message: string } | { kind: 'transaction_control'; keyword: string } | { kind: 'call_stmt' }} MigrationIssue
 * @typedef {{ ok: boolean; filePath: string; issues: MigrationIssue[] }} MigrationAnalysis
 */

/**
 * @param {string} filePath
 * @param {string} sql
 * @returns {MigrationAnalysis}
 */
export function analyzeMigrationSql(filePath, sql) {
  let parsed;
  try {
    parsed = parseSync(sql);
  } catch (error) {
    const message =
      error instanceof SqlError || error instanceof Error
        ? error.message
        : String(error);
    return {
      ok: false,
      filePath,
      issues: [{ kind: "parse_error", message }],
    };
  }

  /** @type {MigrationIssue[]} */
  const issues = [];
  for (const entry of parsed.stmts ?? []) {
    const stmt = entry?.stmt;
    if (!stmt) {
      continue;
    }
    const type = Object.keys(stmt)[0];
    if (type === "TransactionStmt") {
      const tx = stmt.TransactionStmt;
      issues.push({
        kind: "transaction_control",
        keyword: tx?.kind ?? "TransactionStmt",
      });
    } else if (type === "CallStmt") {
      issues.push({ kind: "call_stmt" });
    }
  }

  return {
    ok: issues.length === 0,
    filePath,
    issues,
  };
}

/**
 * @param {MigrationAnalysis} analysis
 * @returns {string | null}
 */
export function formatMigrationAnalysisError(analysis) {
  if (analysis.ok) {
    return null;
  }
  const detail = analysis.issues
    .map((issue) => {
      if (issue.kind === "parse_error") {
        return `parse error: ${issue.message}`;
      }
      if (issue.kind === "transaction_control") {
        return `transaction statement: ${issue.keyword}`;
      }
      if (issue.kind === "call_stmt") {
        return "top-level CALL statement";
      }
      return issue.kind;
    })
    .join("; ");
  return `${analysis.filePath}: migration is not safe for Production db-migrate workflow (${detail}). Remove top-level transaction/CALL statements or split the migration.`;
}

/**
 * @param {string} filePath
 * @param {string} sql
 * @returns {string | null}
 */
export function transactionControlError(filePath, sql) {
  return formatMigrationAnalysisError(analyzeMigrationSql(filePath, sql));
}