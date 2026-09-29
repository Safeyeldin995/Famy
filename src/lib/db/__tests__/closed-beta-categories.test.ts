import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb } from "./monitoring-privilege-harness";

const MIGRATION = "20260929095936_closed_beta_babysitting_tutoring.sql";

function readMigration(name: string) {
  return readFileSync(path.resolve(process.cwd(), "supabase/migrations", name), "utf8");
}

async function applyPhase1SlugOracle(db: PGlite) {
  const sql = readMigration(MIGRATION);
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.is_phase1_category_slug");
  const end = sql.indexOf("$$;", start) + 3;
  await db.exec(sql.slice(start, end));
}

describe("closed beta babysitting + tutoring migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("documents babysitting/tutoring-only closed beta without deleting historical rows", () => {
    const sql = readMigration(MIGRATION);
    expect(sql).toContain("SELECT p_slug IN ('babysitting', 'tutoring')");
    expect(sql).toContain("is_phase1_category_slug(cat.slug)");
    expect(sql).toMatch(/owned child family member is required/i);
    expect(sql).not.toMatch(/DELETE FROM public\.(categories|providers|services)/i);
    expect(sql).not.toMatch(/UPDATE public\.providers SET onboarding_status/i);
  });

  it("evaluates is_phase1_category_slug for tutoring onboarding eligibility", async () => {
    db = await createDisposableDb();
    await applyPhase1SlugOracle(db);
    const rows = await db.query<{ slug: string; allowed: boolean }>(
      `SELECT slug, public.is_phase1_category_slug(slug) AS allowed
       FROM (VALUES ('babysitting'), ('tutoring'), ('home-cleaning')) AS t(slug)`,
    );
    expect(rows.rows).toEqual([
      { slug: "babysitting", allowed: true },
      { slug: "tutoring", allowed: true },
      { slug: "home-cleaning", allowed: false },
    ]);
  });
});
