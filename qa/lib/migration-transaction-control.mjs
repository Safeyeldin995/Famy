/**
 * Detect top-level SQL transaction control outside comments and dollar-quoted bodies.
 * Used by Production db-migrate workflow — embedded BEGIN/COMMIT breaks outer transactions.
 */

/** @typedef {{ line: number; keyword: string; text: string }} TransactionControlHit */

const TX_KEYWORD_RE =
  /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\s*;?\s*$/i;

/**
 * @param {string} sql
 * @returns {TransactionControlHit[]}
 */
export function findTopLevelTransactionControl(sql) {
  /** @type {TransactionControlHit[]} */
  const hits = [];
  let i = 0;
  let line = 1;
  const len = sql.length;

  let stmtStart = 0;
  let stmtStartLine = 1;

  /** @param {number} endExclusive */
  const flushStatement = (endExclusive) => {
    const stmt = sql.slice(stmtStart, endExclusive).trim();
    if (stmt) {
      const match = stmt.match(TX_KEYWORD_RE);
      if (match) {
        hits.push({
          line: stmtStartLine,
          keyword: match[1].toUpperCase().replace(/\s+/g, " "),
          text: stmt,
        });
      }
    }
    stmtStart = endExclusive + 1;
    stmtStartLine = line;
  };

  const advanceLines = (chunk) => {
    line += (chunk.match(/\n/g) ?? []).length;
  };

  while (i < len) {
    const rest = sql.slice(i);

    if (rest.startsWith("--")) {
      const nl = rest.indexOf("\n");
      if (nl === -1) {
        break;
      }
      const chunk = rest.slice(0, nl + 1);
      advanceLines(chunk);
      i += nl + 1;
      stmtStart = i;
      stmtStartLine = line;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) {
        break;
      }
      const chunk = rest.slice(0, end + 2);
      advanceLines(chunk);
      i += end + 2;
      stmtStart = i;
      stmtStartLine = line;
      continue;
    }

    const dollar = rest.match(/^\$([A-Za-z0-9_]*)\$/);
    if (dollar) {
      const tag = dollar[1];
      const openLen = dollar[0].length;
      const close = `$${tag}$`;
      const closeIdx = rest.indexOf(close, openLen);
      if (closeIdx === -1) {
        break;
      }
      const chunk = rest.slice(0, closeIdx + close.length);
      advanceLines(chunk);
      i += closeIdx + close.length;
      stmtStart = i;
      stmtStartLine = line;
      continue;
    }

    const ch = sql[i];
    if (ch === ";") {
      flushStatement(i);
      i++;
      continue;
    }

    if (ch === "\n") {
      i++;
      line++;
      continue;
    }

    i++;
  }

  return hits;
}

/**
 * @param {string} filePath
 * @param {string} sql
 * @returns {string | null} error message, or null if clean
 */
export function transactionControlError(filePath, sql) {
  const hits = findTopLevelTransactionControl(sql);
  if (hits.length === 0) {
    return null;
  }
  const detail = hits
    .map((h) => `line ${h.line}: ${h.keyword}`)
    .join("; ");
  return `${filePath}: migration contains top-level transaction control (${detail}). Remove BEGIN/COMMIT/ROLLBACK/START TRANSACTION/END or split into a workflow-safe migration.`;
}