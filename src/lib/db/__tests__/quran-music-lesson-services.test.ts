import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  createDisposableDb,
  readMigration,
  seedIdentities,
} from "./babysitting-capabilities-harness";
import { TUTORING_MIGRATION } from "./tutoring-teaching-capabilities.test";

const LESSON_MIGRATION = "20261102160000_quran_music_lesson_services.sql";

const TUTORING_CATEGORY = "00000000-0000-0000-0000-000000000213";

const EXTRA_SCHEMA_SQL = `
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_ar text;
INSERT INTO public.categories (id, slug) VALUES ('${TUTORING_CATEGORY}', 'tutoring')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name_en, name_ar, pricing_model)
VALUES ('00000000-0000-0000-0000-000000000314', '${TUTORING_CATEGORY}', 'school-subject-tutoring', 'School', 'مدرسة', 'hourly')
ON CONFLICT (id) DO NOTHING;
`;

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await applyBabysittingMigration(db);
  await db.exec(EXTRA_SCHEMA_SQL);
  await db.exec(readMigration(TUTORING_MIGRATION));
  await db.exec(readMigration(LESSON_MIGRATION));
  await seedIdentities(db);
  return db;
}

describe("quran/music lesson catalog migration", () => {
  it("seeds inactive lesson services, scoped subjects/levels, and NA curriculum", async () => {
    const db = await readyDb();
    const services = await db.query<{ slug: string; is_active: boolean; requires_teaching_curriculum: boolean }>(
      `SELECT slug, is_active, requires_teaching_curriculum FROM public.services
       WHERE slug IN ('quran-lessons', 'music-lessons') ORDER BY slug`,
    );
    expect(services.rows).toEqual([
      { slug: "music-lessons", is_active: false, requires_teaching_curriculum: false },
      { slug: "quran-lessons", is_active: false, requires_teaching_curriculum: false },
    ]);

    const prices = await db.query<{ slug: string; minimum_price: number; maximum_price: number }>(
      `SELECT slug, minimum_price, maximum_price FROM public.services
       WHERE slug IN ('quran-lessons', 'music-lessons') ORDER BY slug`,
    );
    expect(prices.rows.map((row) => ({
      slug: row.slug,
      minimum_price: Number(row.minimum_price),
      maximum_price: Number(row.maximum_price),
    }))).toEqual([
      { slug: "music-lessons", minimum_price: 300, maximum_price: 1000 },
      { slug: "quran-lessons", minimum_price: 150, maximum_price: 500 },
    ]);

    const quranSubjects = await db.query<{ code: string }>(
      `SELECT sub.code
       FROM public.teaching_subjects sub
       JOIN public.teaching_subject_services tss ON tss.subject_id = sub.id
       JOIN public.services svc ON svc.id = tss.service_id
       WHERE svc.slug = 'quran-lessons'
       ORDER BY sub.code`,
    );
    expect(quranSubjects.rows.map((row) => row.code)).toEqual([
      "quran_memorization",
      "quran_recitation_review",
      "quran_tajweed",
    ]);

    const skillLevels = await db.query<{ code: string }>(
      `SELECT lvl.code
       FROM public.teaching_levels lvl
       JOIN public.service_teaching_levels stl ON stl.level_id = lvl.id
       JOIN public.services svc ON svc.id = stl.service_id
       WHERE svc.slug = 'music-lessons'
       ORDER BY lvl.code`,
    );
    expect(skillLevels.rows.map((row) => row.code)).toEqual([
      "skill_advanced",
      "skill_beginner",
      "skill_intermediate",
    ]);

    const schoolLevelCount = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM public.service_teaching_levels stl
       JOIN public.services svc ON svc.id = stl.service_id
       JOIN public.teaching_levels lvl ON lvl.id = stl.level_id
       WHERE svc.slug = 'school-subject-tutoring' AND lvl.level_kind = 'school_grade'`,
    );
    expect(schoolLevelCount.rows[0]?.n).toBeGreaterThan(10);

    const na = await db.query<{ code: string }>(
      `SELECT code FROM public.teaching_curricula WHERE code = 'na'`,
    );
    expect(na.rows[0]?.code).toBe("na");
  });
});
