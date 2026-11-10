/**
 * One-shot generator: replays migrations in PGlite, emits ALTER POLICY + FK indexes.
 * Run: npx tsx scripts/generate-rls-initplan-migration.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  createMigrationReplayDb,
  listMigrationFiles,
  readMigrationFile,
  replayAllMigrations,
  sanitizeMigrationForPglite,
} from "../src/lib/db/__tests__/migration-replay.harness";

const INITPLAN_MIGRATION = "20261110140000_rls_initplan_and_fk_indexes.sql";

type PolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
};

function quoteIdent(id: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(id)) return id;
  return `"${id.replace(/"/g, '""')}"`;
}

function wrapAuthCalls(expr: string | null): string | null {
  if (!expr) return expr;
  return expr.replace(/\bauth\.(uid|role|jwt)\(\)/gi, (match, fn: string, offset, str) => {
    const before = str.slice(Math.max(0, offset - 24), offset).toLowerCase();
    if (/\(select\s+$/.test(before) || before.endsWith("(select ")) return match;
    return `(select auth.${fn.toLowerCase()}())`;
  });
}

function policyAlterSql(row: PolicyRow): string | null {
  const newQual = wrapAuthCalls(row.qual);
  const newCheck = wrapAuthCalls(row.with_check);
  const qualChanged = newQual !== row.qual;
  const checkChanged = newCheck !== row.with_check;
  if (!qualChanged && !checkChanged) return null;

  const table = `${quoteIdent(row.schemaname)}.${quoteIdent(row.tablename)}`;
  const name = quoteIdent(row.policyname);
  const chunks = [`ALTER POLICY ${name} ON ${table}`];
  if (qualChanged && newQual) chunks.push(`USING (${newQual})`);
  if (checkChanged && newCheck) chunks.push(`WITH CHECK (${newCheck})`);
  return `${chunks.join("\n  ")};`;
}

async function fkIndexStatements(
  db: Awaited<ReturnType<typeof createMigrationReplayDb>>,
): Promise<string[]> {
  const { rows } = await db.query<{
    table_name: string;
    column_name: string;
  }>(`
    SELECT
      format('%I.%I', n.nspname, rel.relname) AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
    ORDER BY rel.relname, att.attname
  `);

  const statements: string[] = [];
  for (const fk of rows) {
    const tblOnly = fk.table_name.replace(/^public\./, "");
    const { rows: idxHit } = await db.query(
      `
      SELECT 1
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = $1::regclass
        AND a.attname = $2
        AND i.indisvalid
      LIMIT 1
      `,
      [`public.${tblOnly}`, fk.column_name],
    );
    if (idxHit.length > 0) continue;
    const idx = `idx_${tblOnly}_${fk.column_name}`;
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(idx)} ON public.${quoteIdent(tblOnly)} (${quoteIdent(fk.column_name)});`,
    );
  }
  return [...new Set(statements)];
}

async function listMultiplePermissive(
  db: Awaited<ReturnType<typeof createMigrationReplayDb>>,
): Promise<string[]> {
  const { rows } = await db.query<{ tablename: string; cmd: string; policy_count: string }>(`
    SELECT tablename, cmd, count(*)::text AS policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND permissive = 'PERMISSIVE'
    GROUP BY tablename, cmd
    HAVING count(*) > 1
    ORDER BY tablename, cmd
  `);
  return rows.map((r) => `${r.tablename} (${r.cmd}): ${r.policy_count} permissive policies`);
}

async function replayBaseline(db: Awaited<ReturnType<typeof createMigrationReplayDb>>): Promise<void> {
  for (const file of listMigrationFiles()) {
    if (file === INITPLAN_MIGRATION) continue;
    await db.exec(sanitizeMigrationForPglite(readMigrationFile(file)));
  }
}

async function main(): Promise<void> {
  const db = await createMigrationReplayDb();
  await replayBaseline(db);

  const { rows: policies } = await db.query<PolicyRow>(`
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);

  const alters: string[] = [];
  for (const p of policies) {
    const sql = policyAlterSql(p);
    if (sql) alters.push(sql);
  }

  const indexes = await fkIndexStatements(db);
  const multiPermissive = await listMultiplePermissive(db);
  const { rows: unusedIndexes } = await db.query<{ index_name: string; table_name: string }>(`
    SELECT indexrelid::regclass::text AS index_name, indrelid::regclass::text AS table_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid::regclass::text LIKE 'public.%'
      AND NOT i.indisprimary
      AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
    ORDER BY 2, 1
  `);
  await db.close();

  const header = `-- RLS initplan: wrap auth.uid()/auth.role()/auth.jwt() for per-query evaluation.
-- Missing FK column indexes (Supabase performance advisor).
-- Forward-only. No data changes. Semantics unchanged except initplan wrapping.
-- Part of issue #309.

BEGIN;

`;

  const body = [
    "-- ---------------------------------------------------------------------------",
    "-- 1) RLS policies: (select auth.*()) initplan wrap",
    "-- ---------------------------------------------------------------------------",
    "",
    ...alters,
    "",
    "-- ---------------------------------------------------------------------------",
    "-- 2) Foreign-key covering indexes",
    "-- ---------------------------------------------------------------------------",
    "",
    ...indexes,
    "",
    "COMMIT;",
    "",
  ].join("\n");

  const outPath = path.resolve(
    process.cwd(),
    "supabase/migrations/20261110140000_rls_initplan_and_fk_indexes.sql",
  );
  writeFileSync(outPath, header + body);
  const reportPath = path.resolve(process.cwd(), "scripts/rls-initplan-advisor-report.txt");
  writeFileSync(
    reportPath,
    [
      `Policies altered: ${alters.length} / ${policies.length}`,
      `FK indexes: ${indexes.length}`,
      "",
      "multiple_permissive_policies:",
      ...multiPermissive,
      "",
      "unused_index (report only — not dropped):",
      ...unusedIndexes.map((r) => `${r.table_name} → ${r.index_name}`),
    ].join("\n"),
  );
  console.log(`Wrote ${outPath}`);
  console.log(`Policies altered: ${alters.length} / ${policies.length}`);
  console.log(`FK indexes: ${indexes.length}`);
  console.log(`Multiple permissive groups: ${multiPermissive.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
