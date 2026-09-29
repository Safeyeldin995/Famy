import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readMigration } from "./monitoring-privilege-harness";
import { CLOSED_BETA_MIGRATION, createClosedBetaGatesDb } from "./closed-beta-gates.harness";

describe("closed beta babysitting + tutoring migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("documents babysitting/tutoring-only closed beta without deleting historical rows", () => {
    const sql = readMigration(CLOSED_BETA_MIGRATION);
    expect(sql).toContain("SELECT p_slug IN ('babysitting', 'tutoring')");
    expect(sql).toContain("is_phase1_category_slug(c.slug)");
    expect(sql).toMatch(/Babysitting requires an owned child family member/i);
    expect(sql).not.toMatch(/DELETE FROM public\.(categories|providers|services)/i);
    expect(sql).not.toMatch(/UPDATE public\.providers SET onboarding_status/i);
  });

  it("evaluates is_phase1_category_slug for tutoring onboarding eligibility", async () => {
    db = await createClosedBetaGatesDb();
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
