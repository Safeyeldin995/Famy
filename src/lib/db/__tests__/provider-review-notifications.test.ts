import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  APPLY_ONBOARDING_STATUS_MIGRATION,
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  createDisposableDb,
  extractPublicFunctionBlock,
  IDS,
  ONBOARDING_SUBMIT_MIGRATION,
  queryRows,
  readMigration,
  REQUEST_UPDATED_DETAILS_MIGRATION,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";
export const PROVIDER_REVIEW_MIGRATION = "20261001150500_provider_review_notifications.sql";

const TUTORING_MIGRATION = "20261001130000_tutoring_teaching_capabilities.sql";

const TUTORING_IDS = {
  tutoringCategory: "00000000-0000-0000-0000-000000000213",
  schoolService: "00000000-0000-0000-0000-000000000314",
  languageService: "00000000-0000-0000-0000-000000000315",
};

const EXTRA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS allowed_session_durations int[];
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS minimum_price integer;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS maximum_price integer;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_en text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_ar text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS years_experience int NOT NULL DEFAULT 0;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS last_review_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_public text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_code text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_top_pro boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS vacation_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS max_children_per_booking int;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.provider_admin_internal_notes (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  review_notes_internal text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  actor_id uuid,
  actor_role text,
  action text,
  previous_status public.provider_onboarding_status,
  new_status public.provider_onboarding_status,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.provider_services ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.provider_services ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'in_app',
  type text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL DEFAULT 'system',
  title_en text,
  title_ar text,
  body_en text,
  body_ar text,
  deep_link text,
  booking_id uuid,
  campaign_id uuid
);

INSERT INTO auth.users (id) VALUES
  ('${IDS.providerUser}'), ('${IDS.adminUser}'), ('${IDS.otherProviderUser}')
ON CONFLICT DO NOTHING;
`;

async function seedTutoring(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO public.categories (id, slug) VALUES ('${TUTORING_IDS.tutoringCategory}', 'tutoring')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.services (
      id, category_id, is_active, pricing_model, slug, name_en, minimum_price, maximum_price, allowed_session_durations
    ) VALUES
      ('${TUTORING_IDS.schoolService}', '${TUTORING_IDS.tutoringCategory}', true, 'hourly', 'school-subject-tutoring', 'School subjects', 300, 1500, ARRAY[60,90,120]),
      ('${TUTORING_IDS.languageService}', '${TUTORING_IDS.tutoringCategory}', true, 'hourly', 'language-tutoring', 'Languages', 300, 1500, ARRAY[60,90,120])
    ON CONFLICT (id) DO NOTHING;
  `);
}

const APPLY_SQL = extractPublicFunctionBlock(
  APPLY_ONBOARDING_STATUS_MIGRATION,
  "apply_provider_onboarding_status",
);
const ASSERT_SQL = extractPublicFunctionBlock(
  ONBOARDING_SUBMIT_MIGRATION,
  "assert_onboarding_internal_call",
);
const LOG_SQL = extractPublicFunctionBlock(
  ONBOARDING_SUBMIT_MIGRATION,
  "log_provider_onboarding_event",
);

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(EXTRA_SCHEMA_SQL);
  await seedIdentities(db);
  await applyBabysittingMigration(db);
  await db.exec(ASSERT_SQL);
  await db.exec(LOG_SQL);
  await db.exec(APPLY_SQL);
  await db.exec(readMigration(REQUEST_UPDATED_DETAILS_MIGRATION));
  await seedTutoring(db);
  await db.exec(readMigration(TUTORING_MIGRATION));
  await db.exec(readMigration(PROVIDER_REVIEW_MIGRATION));
  await db.exec(`
    GRANT SELECT, INSERT ON public.notifications TO authenticated, service_role;
    GRANT UPDATE ON public.providers TO authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_set_provider_service_status(uuid, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_review_teaching_capability(uuid, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_remove_onboarding_service(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.assert_tutoring_capability(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz) TO authenticated;
  `);
  return db;
}

async function taxonomyId(db: PGlite, table: string, code: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.${table} WHERE code = $1`,
    [code],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`Missing ${table} code ${code}`);
  return id;
}

describe("provider review notifications migration", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("loads admin onboarding action from the new migration with notification inserts", () => {
    const sql = readMigration(PROVIDER_REVIEW_MIGRATION);
    expect(sql).toContain("provider_onboarding_approved");
    expect(
      extractPublicFunctionBlock(PROVIDER_REVIEW_MIGRATION, "admin_provider_onboarding_action"),
    ).toContain("INSERT INTO public.notifications");
  });

  it("creates onboarding decision notifications without leaking internal admin notes", async () => {
    db = await readyDb();
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'SUBMITTED' WHERE id = '${IDS.provider}';
      COMMIT;
    `);

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(
        db!,
        `SELECT public.admin_provider_onboarding_action($1, 'reject', 'incomplete', 'Public reason shown', 'SECRET_INTERNAL_NOTE')`,
        [IDS.provider],
      );
    });

    const rows = await queryRows<{
      type: string;
      body_en: string;
      payload: Record<string, unknown>;
    }>(db, `SELECT type, body_en, payload FROM public.notifications WHERE user_id = $1`, [
      IDS.providerUser,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("provider_onboarding_rejected");
    expect(rows[0]?.body_en).toContain("Public reason shown");
    expect(rows[0]?.body_en).not.toContain("SECRET_INTERNAL_NOTE");
    expect(JSON.stringify(rows[0]?.payload ?? {})).not.toContain("SECRET_INTERNAL_NOTE");
  });

  it("notifies on provider service and teaching capability review", async () => {
    db = await readyDb();
    const psRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_services WHERE provider_id = $1 AND service_id = $2 LIMIT 1`,
      [IDS.provider, IDS.cleaningService],
    );
    const psId = psRows[0]?.id;
    expect(psId).toBeTruthy();

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db!, `SELECT public.admin_set_provider_service_status($1, 'approved')`, [
        psId,
      ]);
    });

    const subjectId = await taxonomyId(db, "teaching_subjects", "english");
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(db, "teaching_levels", "g1");
    let capId: string | undefined;
    await asUser(db, IDS.providerUser, async () => {
      const inserted = await queryRows<{ id: string }>(
        db!,
        `SELECT public.provider_upsert_teaching_capability($1, $2, $3, $4, 60, 500, NULL) AS id`,
        [TUTORING_IDS.languageService, subjectId, curriculumId, levelId],
      );
      capId = inserted[0]?.id;
    });
    expect(capId).toBeTruthy();

    await asUser(db, IDS.adminUser, async () => {
      await queryRows(db!, `SELECT public.admin_review_teaching_capability($1, 'approved')`, [
        capId,
      ]);
    });

    const types = await queryRows<{ type: string }>(
      db,
      `SELECT type FROM public.notifications WHERE user_id = $1 ORDER BY created_at`,
      [IDS.providerUser],
    );
    expect(types.map((r) => r.type)).toEqual(
      expect.arrayContaining(["provider_service_approved", "teaching_capability_approved"]),
    );
  });

  it("allows bio edits after approval but still blocks city and years", async () => {
    db = await readyDb();
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers
      SET onboarding_status = 'APPROVED', bio_en = 'Old', bio_ar = 'قديم', city = 'Maadi', years_experience = 3
      WHERE id = '${IDS.provider}';
      COMMIT;
    `);

    const bioOk = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET bio_en = 'New bio', bio_ar = 'سيرة جديدة' WHERE id = $1`,
      [IDS.provider],
    );
    expect(bioOk.error, bioOk.error).toBeUndefined();
    expect(bioOk.ok).toBe(true);

    const cityBlocked = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET city = 'Zamalek' WHERE id = $1`,
      [IDS.provider],
    );
    expect(cityBlocked.ok).toBe(false);

    const yearsBlocked = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET years_experience = 9 WHERE id = $1`,
      [IDS.provider],
    );
    expect(yearsBlocked.ok).toBe(false);
  });

  it("removes school-subject language pairs while preserving legacy capabilities", async () => {
    db = await readyDb();
    const arabicId = await taxonomyId(db, "teaching_subjects", "arabic");
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(db, "teaching_levels", "g1");

    const legacyCap = "00000000-0000-0000-0000-000000000901";
    await db.exec(`
      INSERT INTO public.provider_teaching_capabilities (
        id, provider_id, service_id, subject_id, curriculum_id, level_id,
        session_duration_min, session_price, status, submitted_at
      ) VALUES (
        '${legacyCap}', '${IDS.provider}', '${TUTORING_IDS.schoolService}', '${arabicId}', '${curriculumId}', '${levelId}',
        60, 500, 'approved', now()
      );
    `);

    const schoolArabic = await queryRows<{ n: number }>(
      db,
      `
        SELECT COUNT(*)::int AS n
        FROM public.teaching_subject_services tss
        JOIN public.teaching_subjects sub ON sub.id = tss.subject_id
        JOIN public.services svc ON svc.id = tss.service_id
        WHERE sub.code = 'arabic' AND svc.slug = 'school-subject-tutoring'
      `,
    );
    expect(schoolArabic[0]?.n).toBe(0);

    const languageArabic = await queryRows<{ n: number }>(
      db,
      `
        SELECT COUNT(*)::int AS n
        FROM public.teaching_subject_services tss
        JOIN public.teaching_subjects sub ON sub.id = tss.subject_id
        JOIN public.services svc ON svc.id = tss.service_id
        WHERE sub.code = 'arabic' AND svc.slug = 'language-tutoring'
      `,
    );
    expect(languageArabic[0]?.n).toBe(1);

    const legacy = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_teaching_capabilities WHERE id = $1`,
      [legacyCap],
    );
    expect(legacy).toHaveLength(1);

    const assertRows = await queryRows<{ capability_id: string }>(
      db,
      `
        SELECT capability_id FROM public.assert_tutoring_capability(
          $1, $2, $3, 'arabic', 'eg_national_ar', 'g1',
          '2026-10-01T10:00:00Z'::timestamptz, '2026-10-01T11:00:00Z'::timestamptz
        )
      `,
      [IDS.provider, TUTORING_IDS.schoolService, legacyCap],
    );
    expect(assertRows[0]?.capability_id).toBe(legacyCap);
  });

  it("enforces provider_remove_onboarding_service authorization and status gates", async () => {
    db = await readyDb();
    await db.exec(`
      DELETE FROM public.provider_services
      WHERE provider_id = '${IDS.provider}' AND service_id = '${IDS.babysittingService}';
      INSERT INTO public.provider_services (id, provider_id, service_id, status)
      VALUES ('00000000-0000-0000-0000-000000000901', '${IDS.provider}', '${IDS.babysittingService}', 'pending');
    `);

    const draftOk = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_remove_onboarding_service($1)`,
      [IDS.babysittingService],
    );
    expect(draftOk.ok).toBe(true);

    await db.exec(`
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES ('${IDS.provider}', '${IDS.cleaningService}', 'pending')
      ON CONFLICT DO NOTHING;
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'SUBMITTED' WHERE id = '${IDS.provider}';
      COMMIT;
    `);

    const submittedBlocked = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_remove_onboarding_service($1)`,
      [IDS.cleaningService],
    );
    expect(submittedBlocked.ok).toBe(false);

    await db.exec(`
      INSERT INTO public.provider_services (provider_id, service_id, status)
      VALUES ('${IDS.otherProvider}', '${IDS.cleaningService}', 'pending')
      ON CONFLICT DO NOTHING;
    `);
    const otherProvider = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_remove_onboarding_service($1)`,
      [IDS.cleaningService],
    );
    expect(otherProvider.ok).toBe(false);

    const anon = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.provider_remove_onboarding_service($1)`,
      [IDS.cleaningService],
    );
    expect(anon.ok).toBe(false);
  });
});
