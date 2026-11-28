#!/usr/bin/env node
/**
 * Local CI only: make the migration folder loadable by `supabase start`.
 *
 * The Supabase CLI records each file's numeric prefix as its version, so two
 * files that share one prefix stop the local stack with a duplicate key error.
 * Production applied both files long ago, so the committed names stay as they
 * are. In the CI checkout only, every repeated prefix after the first is moved
 * forward by one second (or more if that is taken). File order and SQL are
 * unchanged, so the schema built here is the one Production runs.
 *
 * Refuses to run outside CI unless FAMY_LOCAL_CI=1, so it never renames a
 * developer's files by accident.
 */
import fs from "node:fs";
import path from "node:path";

if (process.env.CI !== "true" && process.env.FAMY_LOCAL_CI !== "1") {
  console.error("[prepare-migrations] refusing to rename files outside CI (set FAMY_LOCAL_CI=1).");
  process.exit(1);
}

const dir = path.resolve(process.cwd(), "supabase/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const allVersions = new Set(
  files.map((f) => f.match(/^(\d{14})_/)?.[1]).filter(Boolean).map((v) => BigInt(v)),
);
const used = new Set();
let renamed = 0;

for (const file of files) {
  const match = file.match(/^(\d{14})_(.+)$/);
  if (!match) continue;
  let version = BigInt(match[1]);
  if (!used.has(version)) {
    used.add(version);
    continue;
  }
  while (used.has(version) || allVersions.has(version)) version += 1n;
  used.add(version);
  const next = `${version}_${match[2]}`;
  fs.renameSync(path.join(dir, file), path.join(dir, next));
  console.log(`[prepare-migrations] ${file} -> ${next}`);
  renamed += 1;
}

console.log(`[prepare-migrations] ${files.length} migrations, ${renamed} renamed for the local stack.`);
