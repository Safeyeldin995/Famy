import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findTopLevelTransactionControl,
  transactionControlError,
} from "../lib/migration-transaction-control.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("migration transaction control scanner", () => {
  it("flags top-level BEGIN and COMMIT", () => {
    const sql = `SELECT 1;
BEGIN;
SELECT 2;
COMMIT;`;
    const hits = findTopLevelTransactionControl(sql);
    expect(hits.map((h) => h.keyword)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("ignores transaction keywords inside dollar-quoted bodies", () => {
    const sql = `DO $$
BEGIN
  PERFORM 1;
END;
$$;
COMMIT;`;
    const hits = findTopLevelTransactionControl(sql);
    expect(hits.map((h) => h.keyword)).toEqual(["COMMIT"]);
  });

  it("ignores line and block comments", () => {
    const sql = `-- BEGIN;
/* COMMIT; */
SELECT 1;`;
    expect(findTopLevelTransactionControl(sql)).toEqual([]);
  });

  it("flags the security advisor migration file", () => {
    const file = path.join(
      REPO_ROOT,
      "supabase/migrations/20261027120000_supabase_security_advisor_remediation.sql",
    );
    const err = transactionControlError(file, readFileSync(file, "utf8"));
    expect(err).toMatch(/BEGIN/);
    expect(err).toMatch(/COMMIT/);
  });
});