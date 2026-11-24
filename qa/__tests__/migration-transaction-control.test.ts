import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  analyzeMigrationSql,
  initMigrationParser,
  transactionControlError,
} from "../lib/migration-transaction-control.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("migration transaction control (libpg_query)", () => {
  beforeAll(async () => {
    await initMigrationParser();
  });

  it.each([
    ["COMMIT /* x */;", "TRANS_STMT_COMMIT"],
    ["COMMIT /* a /* b */ a */;", "TRANS_STMT_COMMIT"],
    ["SELECT '--'; COMMIT;", "TRANS_STMT_COMMIT"],
    ["COMMIT WORK;", "TRANS_STMT_COMMIT"],
    ["COMMIT AND CHAIN;", "TRANS_STMT_COMMIT"],
  ])("rejects Codex case %s", (sql, kind) => {
    const err = transactionControlError("case.sql", sql);
    expect(err).not.toBeNull();
    expect(err).toMatch(/transaction statement/);
    const analysis = analyzeMigrationSql("case.sql", sql);
    expect(analysis.issues.some((i) => i.kind === "transaction_control")).toBe(
      true,
    );
    if (analysis.issues[0]?.kind === "transaction_control") {
      expect(analysis.issues[0].keyword).toBe(kind);
    }
  });

  it('allows quoted identifier "--" with unrelated COMMIT on same batch', () => {
    const sql = 'SELECT "--" AS x; SELECT 1;';
    expect(transactionControlError("id.sql", sql)).toBeNull();
  });

  it("rejects COMMIT after quoted identifier statement", () => {
    const sql = 'SELECT "--" AS x; COMMIT;';
    expect(transactionControlError("id.sql", sql)).toMatch(/TRANS_STMT_COMMIT/);
  });

  it("allows COMMIT only inside a function dollar body", () => {
    const sql = `CREATE OR REPLACE FUNCTION f() RETURNS text LANGUAGE sql AS $$
SELECT 'COMMIT';
$$;`;
    expect(transactionControlError("fn.sql", sql)).toBeNull();
  });

  it("rejects top-level BEGIN and COMMIT", () => {
    const sql = `SELECT 1;
BEGIN;
SELECT 2;
COMMIT;`;
    const analysis = analyzeMigrationSql("bare.sql", sql);
    expect(analysis.ok).toBe(false);
    expect(
      analysis.issues.filter((i) => i.kind === "transaction_control").length,
    ).toBe(2);
  });

  it("rejects top-level CALL", () => {
    expect(transactionControlError("call.sql", "CALL foo();")).toMatch(
      /CALL/,
    );
  });

  it("allows DO blocks without transaction statements", () => {
    const sql = `DO $$
BEGIN
  PERFORM 1;
END;
$$;`;
    expect(transactionControlError("do.sql", sql)).toBeNull();
  });

  it("flags the security advisor migration file", () => {
    const file = path.join(
      REPO_ROOT,
      "supabase/migrations/20261027120000_supabase_security_advisor_remediation.sql",
    );
    const err = transactionControlError(file, readFileSync(file, "utf8"));
    expect(err).toMatch(/transaction statement/);
  });
});