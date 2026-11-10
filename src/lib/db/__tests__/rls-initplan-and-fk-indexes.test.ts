import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createMigrationReplayDb,
  listMigrationFiles,
  readMigrationFile,
  replayAllMigrations,
  sanitizeMigrationForPglite,
} from "./migration-replay.harness";

const INITPLAN_MIGRATION = "20261110140000_rls_initplan_and_fk_indexes.sql";

type PolicyKey = string;

type PolicySnap = {
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

function policyKey(row: { tablename: string; policyname: string }): PolicyKey {
  return `${row.tablename}::${row.policyname}`;
}

const INITPLAN_AUTH_RE =
  /\(\s*select\s+auth\.(uid|role|jwt)\(\)(?:\s+as\s+\w+)?\s*\)/gi;

function stripInitplanAuthWraps(expr: string): string {
  return expr.replace(INITPLAN_AUTH_RE, "auth.$1()");
}

function normalizePolicyExpr(expr: string | null): string | null {
  if (expr == null) return null;
  return stripInitplanAuthWraps(expr).replace(/\s+/g, " ").trim();
}

function hasBareAuthCall(expr: string | null): boolean {
  if (!expr) return false;
  const withoutInitplan = expr.replace(
    /\(\s*SELECT\s+auth\.(uid|role|jwt)\(\)(?:\s+AS\s+\w+)?\s*\)/gi,
    "__initplan__",
  );
  return /\bauth\.(uid|role|jwt)\(\)/i.test(withoutInitplan);
}

async function loadPolicies(db: PGlite): Promise<Map<PolicyKey, PolicySnap>> {
  const { rows } = await db.query<{
    tablename: string;
    policyname: string;
    permissive: string;
    roles: string[] | string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);

  const map = new Map<PolicyKey, PolicySnap>();
  for (const row of rows) {
    const roles = Array.isArray(row.roles)
      ? [...row.roles].sort()
      : String(row.roles)
          .replace(/[{}]/g, "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
          .sort();
    map.set(policyKey(row), {
      permissive: row.permissive,
      roles,
      cmd: row.cmd,
      qual: normalizePolicyExpr(row.qual),
      with_check: normalizePolicyExpr(row.with_check),
    });
  }
  return map;
}

async function replayWithoutInitplanMigration(db: PGlite): Promise<void> {
  for (const file of listMigrationFiles()) {
    if (file === INITPLAN_MIGRATION) continue;
    const sql = sanitizeMigrationForPglite(readMigrationFile(file));
    await db.exec(sql);
  }
}

async function assertAllForeignKeysIndexed(db: PGlite): Promise<void> {
  const { rows } = await db.query<{ table_name: string; column_name: string }>(`
    SELECT format('%I.%I', n.nspname, rel.relname) AS table_name, att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f' AND n.nspname = 'public'
  `);

  const missing: string[] = [];
  for (const fk of rows) {
    const tblOnly = fk.table_name.replace(/^public\./, "");
    const { rows: idxHit } = await db.query(
      `
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = $1::regclass AND a.attname = $2 AND i.indisvalid
      LIMIT 1
      `,
      [`public.${tblOnly}`, fk.column_name],
    );
    if (idxHit.length === 0) missing.push(`${fk.table_name}.${fk.column_name}`);
  }
  expect(missing, `unindexed FK columns: ${missing.join(", ")}`).toEqual([]);
}

let db: PGlite;
let beforeInitplan: Map<PolicyKey, PolicySnap>;

beforeAll(async () => {
  const baselineDb = await createMigrationReplayDb();
  await replayWithoutInitplanMigration(baselineDb);
  beforeInitplan = await loadPolicies(baselineDb);
  await baselineDb.close();

  db = await createMigrationReplayDb();
  await replayAllMigrations(db);
}, 180000);

afterAll(async () => {
  await db?.close();
});

describe("rls initplan and FK indexes (#309)", () => {
  it("wraps every policy auth.uid/role/jwt call in a select initplan", async () => {
    const { rows } = await db.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(`
      SELECT tablename, policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
    `);
    const offenders: string[] = [];
    for (const row of rows) {
      if (hasBareAuthCall(row.qual) || hasBareAuthCall(row.with_check)) {
        offenders.push(`${row.tablename}.${row.policyname}`);
      }
    }
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("preserves policy semantics aside from initplan wrapping", async () => {
    const after = await loadPolicies(db);
    expect(after.size).toBe(beforeInitplan.size);
    for (const [key, before] of beforeInitplan) {
      const got = after.get(key);
      expect(got, `missing policy ${key}`).toBeDefined();
      expect(got).toEqual(before);
    }
  });

  it("indexes every public foreign-key column", async () => {
    await assertAllForeignKeysIndexed(db);
  });
});
