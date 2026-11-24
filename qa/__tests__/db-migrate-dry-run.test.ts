import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const HARNESS = path.join(REPO_ROOT, "qa/harness-db-migrate-dry-run.sh");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("db-migrate run_dry_run", () => {
  it("exits 0 on successful mocked psql with set -u (EXIT trap does not reference unbound txn_sql)", () => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "famy-mig-"));
    tempDirs.push(staging);
    const rel = "supabase/migrations/20261101000000_test_batch.sql";
    fs.mkdirSync(path.join(staging, "supabase/migrations"), { recursive: true });
    fs.writeFileSync(path.join(staging, rel), "SELECT 1;\n");

    const result = spawnSync("bash", [HARNESS], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MIGRATIONS_ROOT: staging,
        MIGRATION_FILES: rel,
      },
      encoding: "utf8",
    });

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).toBe(0);
    expect(output).toContain("Dry run PASS");
    expect(output).not.toMatch(/unbound variable/i);
    expect(output).not.toMatch(/txn_sql/);
  });
});