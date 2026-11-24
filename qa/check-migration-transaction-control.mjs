#!/usr/bin/env node
/**
 * CLI: fail if a migration file is unsafe for the Production db-migrate workflow.
 * Usage: node qa/check-migration-transaction-control.mjs <path> [path...]
 */
import { readFileSync } from "node:fs";
import {
  analyzeMigrationSql,
  formatMigrationAnalysisError,
  initMigrationParser,
} from "./lib/migration-transaction-control.mjs";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: check-migration-transaction-control.mjs <file.sql> [...]");
  process.exit(2);
}

await initMigrationParser();

let failed = 0;
for (const file of paths) {
  const sql = readFileSync(file, "utf8");
  const analysis = analyzeMigrationSql(file, sql);
  const err = formatMigrationAnalysisError(analysis);
  if (err) {
    console.error(`::error::${err}`);
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);