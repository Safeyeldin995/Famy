/**
 * Detect top-level transaction control via PostgreSQL libpg_query (libpg-query).
 * Used by Production db-migrate workflow — embedded BEGIN/COMMIT breaks outer transactions.
 */
import { loadModule, parseSync, SqlError } from "libpg-query";

let parserReady = null;

/** GUCs that change SQL lexing; migrations must not alter them before other statements. */
export const LEXER_GUCS = new Set([
  "standard_conforming_strings",
  "backslash_quote",
  "escape_string_warning",
  "client_encoding",
]);

/** @returns {Promise<void>} */
export async function initMigrationParser() {
  if (!parserReady) {
    parserReady = loadModule();
  }
  await parserReady;
}

/**
 * @typedef {{ kind: 'parse_error'; message: string } | { kind: 'transaction_control'; keyword: string } | { kind: 'call_stmt' } | { kind: 'lexer_setting'; name: string }} MigrationIssue
 * @typedef {{ ok: boolean; filePath: string; issues: MigrationIssue[] }} MigrationAnalysis
 */

/**
 * @param {unknown} node
 * @returns {string | null}
 */
function extractStringConst(node) {
  if (!node || typeof node !== "object") {
    return null;
  }
  const direct = /** @type {{ sval?: { sval?: string } }} */ (node);
  if (direct.sval?.sval) {
    return direct.sval.sval;
  }
  const wrapped = /** @type {{ A_Const?: { sval?: { sval?: string } } }} */ (
    node
  );
  return wrapped.A_Const?.sval?.sval ?? null;
}

/**
 * @param {unknown} selectStmt
 * @returns {string[]}
 */
function lexerGucsFromSetConfigSelect(selectStmt) {
  const stmt = /** @type {{ targetList?: unknown[] }} */ (selectStmt);
  /** @type {string[]} */
  const found = [];
  for (const target of stmt.targetList ?? []) {
    const res = /** @type {{ ResTarget?: { val?: unknown } }} */ (target);
    const call = /** @type {{ funcname?: { String?: { sval?: string } } }[]; args?: unknown[] }} */ (
      res.ResTarget?.val?.FuncCall ?? res.ResTarget?.val
    );
    if (!call?.funcname) {
      continue;
    }
    const fname = call.funcname[0]?.String?.sval;
    if (fname !== "set_config") {
      continue;
    }
    const guc = extractStringConst(call.args?.[0]);
    if (guc && LEXER_GUCS.has(guc.toLowerCase())) {
      found.push(guc);
    }
  }
  return found;
}

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
    } else if (type === "VariableSetStmt") {
      const vs = stmt.VariableSetStmt;
      const name = vs?.name?.toLowerCase?.() ?? "";
      if (LEXER_GUCS.has(name)) {
        issues.push({ kind: "lexer_setting", name: vs.name });
      }
    } else if (type === "SelectStmt") {
      for (const guc of lexerGucsFromSetConfigSelect(stmt.SelectStmt)) {
        issues.push({ kind: "lexer_setting", name: guc });
      }
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
      if (issue.kind === "lexer_setting") {
        return `lexer-affecting setting: ${issue.name}`;
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