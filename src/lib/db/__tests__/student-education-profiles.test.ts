import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  createDisposableDb,
  IDS,
  queryRows,
  readMigration,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";
import { TUTORING_MIGRATION } from "./tutoring-teaching-capabilities.test";

export const STUDENT_EDUCATION_MIGRATION = "20261004100000_student_education_profiles.sql";

const EXTRA_SCHEMA_SQL = `
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
`;

const AUTH_USERS_STUB_SQL = `
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id)
SELECT id FROM public.profiles
ON CONFLICT (id) DO NOTHING;
`;

async function taxonomyId(db: PGlite, table: string, code: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.${table} WHERE code = $1`,
    [code],
  );
  return rows[0]!.id;
}

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(EXTRA_SCHEMA_SQL);
  await seedIdentities(db);
  await db.exec(AUTH_USERS_STUB_SQL);
  await applyBabysittingMigration(db);
  await db.exec(readMigration(TUTORING_MIGRATION));
  await db.exec(readMigration(STUDENT_EDUCATION_MIGRATION));
  await db.exec(`
    ALTER TABLE public.family_members
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    GRANT SELECT, INSERT, UPDATE ON public.family_members TO authenticated;
    ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "family_members_customer_all" ON public.family_members;
    CREATE POLICY "family_members_customer_all" ON public.family_members FOR ALL TO authenticated
      USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());
    DROP POLICY IF EXISTS "family_members_admin_all" ON public.family_members;
    CREATE POLICY "family_members_admin_all" ON public.family_members FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  `);
  return db;
}

describe("student education profiles migration", () => {
  let db: PGlite | null = null;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = null;
    }
  });

  it("replays cleanly on top of tutoring capabilities", async () => {
    db = await readyDb();
    const columns = await queryRows<{ column_name: string }>(
      db,
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'family_members'
          AND column_name LIKE 'education_%'
        ORDER BY 1
      `,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      "education_curriculum_id",
      "education_level_id",
    ]);
  });

  it("allows owner writes and denies other customers, providers, and anon", async () => {
    const activeDb = await readyDb();
    db = activeDb;
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(db, "teaching_levels", "g10");

    const ownerWrite = await asUser(activeDb, IDS.customer, async () =>
      activeDb.query(
        `INSERT INTO public.customer_education_profiles (customer_id, education_curriculum_id, education_level_id)
         VALUES ($1, $2, $3)`,
        [IDS.customer, curriculumId, levelId],
      ),
    );
    expect(ownerWrite).toBeDefined();

    const otherCustomerRead = await asUser(activeDb, IDS.otherCustomer, async () =>
      queryRows(activeDb, `SELECT customer_id FROM public.customer_education_profiles WHERE customer_id = $1`, [
        IDS.customer,
      ]),
    );
    expect(otherCustomerRead).toHaveLength(0);

    const providerRead = await asUser(activeDb, IDS.providerUser, async () =>
      queryRows(activeDb, `SELECT customer_id FROM public.customer_education_profiles WHERE customer_id = $1`, [
        IDS.customer,
      ]),
    );
    expect(providerRead).toHaveLength(0);

    const crossWrite = await tryAsUser(
      db,
      IDS.otherCustomer,
      `INSERT INTO public.customer_education_profiles (customer_id, education_curriculum_id, education_level_id)
       VALUES ($1, $2, $3)`,
      [IDS.customer, curriculumId, levelId],
    );
    expect(crossWrite.ok).toBe(false);
  });

  it("rejects inactive or unknown taxonomy ids", async () => {
    db = await readyDb();
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    await db.exec(`UPDATE public.teaching_levels SET is_active = false WHERE code = 'g10'`);
    const levelId = await taxonomyId(db, "teaching_levels", "g10");

    const inactive = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.customer_education_profiles (customer_id, education_curriculum_id, education_level_id)
       VALUES ($1, $2, $3)`,
      [IDS.customer, curriculumId, levelId],
    );
    expect(inactive.ok).toBe(false);
    expect(inactive.error).toMatch(/inactive level/i);

    const unknown = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.customer_education_profiles (customer_id, education_curriculum_id, education_level_id)
       VALUES ($1, $2, $3)`,
      [IDS.customer, curriculumId, "00000000-0000-0000-0000-000000009999"],
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/inactive level/i);
  });

  it("blocks provider reads of family member education columns", async () => {
    const activeDb = await readyDb();
    db = activeDb;
    const curriculumId = await taxonomyId(activeDb, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(activeDb, "teaching_levels", "g10");
    await asUser(activeDb, IDS.customer, async () => {
      await activeDb.query(
        `UPDATE public.family_members
         SET education_curriculum_id = $1, education_level_id = $2
         WHERE id = $3 AND customer_id = $4`,
        [curriculumId, levelId, IDS.childMember, IDS.customer],
      );
    });

    const providerFamilyRead = await asUser(activeDb, IDS.providerUser, async () =>
      queryRows(activeDb, `SELECT id FROM public.family_members WHERE id = $1`, [IDS.childMember]),
    );
    expect(providerFamilyRead).toHaveLength(0);
  });
});
