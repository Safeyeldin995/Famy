#!/usr/bin/env node
/**
 * Inventory: list supabase/migrations/*.sql files rejected by the db-migrate validator.
 * Always exits 0 — informational for CI (existing history may include transaction wrappers).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeMigrationSql,
  formatMigrationAnalysisError,
  initMigrationParser,
} from "./lib/migration-transaction-control.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

await initMigrationParser();

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** @type {string[]} */
const rejected = [];

for (const name of files) {
  const filePath = path.join(MIGRATIONS_DIR, name);
  const sql = readFileSync(filePath, "utf8");
  const analysis = analyzeMigrationSql(path.relative(REPO_ROOT, filePath), sql);
  if (!analysis.ok) {
    rejected.push(formatMigrationAnalysisError(analysis) ?? name);
  }
}

console.log(
  `[db-migrate] Scanned ${files.length} migration file(s); ${rejected.length} incompatible with Production db-migrate (top-level transaction/CALL or parse error).`,
);

if (rejected.length === 0) {
  console.log("[db-migrate] No incompatible migrations.");
} else {
  console.log("[db-migrate] Incompatible files:");
  for (const line of rejected) {
    console.log(`  - ${line}`);
  }
  console.log(
    "[db-migrate] These files remain in repo history; the workflow rejects them when selected for dispatch.",
  );
}

process.exit(0);