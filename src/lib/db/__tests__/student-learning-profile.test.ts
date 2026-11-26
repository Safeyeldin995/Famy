import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createProviderLifecycleDb,
  IDS,
  queryRows,
  seedDraftProvider,
  tryAsAnon,
  tryAsUser,
} from "./provider-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createProviderLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("BEGIN");
});

afterEach(async () => {
  await db.exec("ROLLBACK");
});

const OTHER_PROVIDER = "00000000-0000-0000-0000-00000000a112";

async function id(table: string, code: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(db, `SELECT id FROM public.${table} WHERE code = $1`, [code]);
  if (!rows[0]) throw new Error(`missing ${table}.${code}`);
  return rows[0].id;
}

async function serviceId(slug: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(db, `SELECT id FROM public.services WHERE slug = $1`, [slug]);
  if (!rows[0]) throw new Error(`missing service ${slug}`);
  return rows[0].id;
}

async function subjectFor(service: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT tss.subject_id AS id FROM public.teaching_subject_services tss
       JOIN public.teaching_subjects ts ON ts.id = tss.subject_id
      WHERE tss.service_id = $1 ORDER BY ts.sort_order, ts.code LIMIT 1`,
    [service],
  );
  if (!rows[0]) throw new Error("no subject for service");
  return rows[0].id;
}

/** Second approved tutor + approved provider rows so match tests have two candidates. */
async function seedProviders() {
  await seedDraftProvider(db);
  await db.exec(`
    SELECT set_config('app.onboarding_status_transition', '1', true);
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.otherProviderUser}', '{"signup_role":"provider","full_name":"Second Tutor"}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, offering_mode)
    VALUES ('${OTHER_PROVIDER}', '${IDS.otherProviderUser}', 150, 'APPROVED', 'both')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.providers SET onboarding_status = 'APPROVED', offering_mode = 'both' WHERE id = '${IDS.provider}';
    SELECT set_config('app.onboarding_status_transition', '', true);
  `);
}

async function capability(opts: {
  provider: string;
  service: string;
  subject: string;
  curriculum: string;
  level: string;
  status?: string;
  price?: number;
}) {
  await db.query(
    `INSERT INTO public.provider_teaching_capabilities
       (provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status)
     VALUES ($1, $2, $3, $4, $5, 60, $6, $7)`,
    [opts.provider, opts.service, opts.subject, opts.curriculum, opts.level, opts.price ?? 400, opts.status ?? "approved"],
  );
}

/** Eligibility has its own tests; here every candidate counts as bookable so the filter is what is tested. */
async function stubEligibility() {
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
      p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL,
      p_service_mode text DEFAULT 'in_person'
    )
    RETURNS TABLE (
      provider_id uuid, service_id uuid, service_name_en text, service_name_ar text,
      identity_valid boolean, account_active boolean, verified boolean,
      service_approved boolean, service_active boolean, effective_price numeric,
      minimum_price numeric, maximum_price numeric, price_valid boolean,
      requirements_complete boolean, evidence_approved boolean, zone_covered boolean,
      address_covered boolean, availability_valid boolean, operational_clear boolean,
      is_eligible boolean, failure_reasons text[]
    ) LANGUAGE sql STABLE AS $f$
      SELECT p_provider_id, p_service_id, NULL::text, NULL::text, true, true, true, true, true,
             NULL::numeric, NULL::numeric, NULL::numeric, true, true, true, true, true, true, true,
             (p_provider_id <> '${OTHER_PROVIDER}'::uuid OR p_service_mode = 'online'), ARRAY[]::text[]
    $f$;
  `);
}

async function match(args: unknown[]): Promise<string[]> {
  const rows = await queryRows<{ provider_id: string }>(
    db,
    `SELECT provider_id FROM public.match_tutors_for_student($1, $2, $3, $4, $5) ORDER BY provider_id`,
    args,
  );
  return rows.map((r) => r.provider_id);
}

describe("student learning profile (20261126160000)", () => {
  it("adds the Azhar system and per-system grade labels", async () => {
    const rows = await queryRows<{ code: string; style: string }>(
      db,
      `SELECT code, level_label_style AS style FROM public.teaching_curricula
        WHERE code IN ('eg_azhar', 'british', 'american', 'ib', 'eg_national_ar', 'na') ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: "american", style: "american_grade" },
      { code: "british", style: "british_year" },
      { code: "eg_azhar", style: "eg" },
      { code: "eg_national_ar", style: "eg" },
      { code: "ib", style: "ib_programme" },
      { code: "na", style: "plain" },
    ]);
    const labels = await queryRows<Record<string, string>>(
      db,
      `SELECT public.teaching_level_label('g3', 'eg', 'ar') AS eg3,
              public.teaching_level_label('g8', 'eg', 'ar') AS eg8,
              public.teaching_level_label('g11', 'eg', 'en') AS eg11,
              public.teaching_level_label('g1', 'british_year', 'ar') AS br1,
              public.teaching_level_label('kg', 'british_year', 'en') AS brkg,
              public.teaching_level_label('g4', 'american_grade', 'en') AS us4,
              public.teaching_level_label('g7', 'ib_programme', 'en') AS ib7,
              public.teaching_level_label('skill_beginner', 'plain', 'ar', 'مبتدئ') AS skill`,
    );
    expect(labels[0]).toEqual({
      eg3: "3 ابتدائي",
      eg8: "2 إعدادي",
      eg11: "Secondary 2",
      br1: "Year 2",
      brkg: "Year 1",
      us4: "Grade 4",
      ib7: "MYP · Grade 7",
      skill: "مبتدئ",
    });
  });

  it("matches only tutors for the exact subject, system and grade (school tutoring)", async () => {
    await seedProviders();
    await stubEligibility();
    const svc = await serviceId("school-subject-tutoring");
    const subject = await subjectFor(svc);
    const british = await id("teaching_curricula", "british");
    const american = await id("teaching_curricula", "american");
    const g4 = await id("teaching_levels", "g4");
    const g5 = await id("teaching_levels", "g5");

    await capability({ provider: IDS.provider, service: svc, subject, curriculum: british, level: g4 });
    await capability({ provider: OTHER_PROVIDER, service: svc, subject, curriculum: american, level: g4 });
    await capability({ provider: OTHER_PROVIDER, service: svc, subject, curriculum: british, level: g5, status: "pending" });

    expect(await match([svc, subject, british, g4, "online"])).toEqual([IDS.provider]);
    expect(await match([svc, subject, american, g4, "online"])).toEqual([OTHER_PROVIDER]);
    // Pending capabilities never match.
    expect(await match([svc, subject, british, g5, "online"])).toEqual([]);
    // In person the stub marks the second tutor as not bookable.
    expect(await match([svc, subject, american, g4, "in_person"])).toEqual([]);
  });

  it("matches Quran / music on subject + skill level and homework on system + grade", async () => {
    await seedProviders();
    await stubEligibility();
    const quran = await serviceId("quran-lessons");
    const quranSubject = await subjectFor(quran);
    const na = await id("teaching_curricula", "na");
    const beginner = await id("teaching_levels", "skill_beginner");
    const advanced = await id("teaching_levels", "skill_advanced");
    await capability({ provider: IDS.provider, service: quran, subject: quranSubject, curriculum: na, level: beginner });

    expect(await match([quran, quranSubject, null, beginner, "online"])).toEqual([IDS.provider]);
    expect(await match([quran, quranSubject, null, advanced, "online"])).toEqual([]);

    const homework = await serviceId("homework-support");
    const homeworkSubject = await subjectFor(homework);
    const egAr = await id("teaching_curricula", "eg_national_ar");
    const g2 = await id("teaching_levels", "g2");
    const g3 = await id("teaching_levels", "g3");
    await capability({ provider: OTHER_PROVIDER, service: homework, subject: homeworkSubject, curriculum: egAr, level: g2 });
    expect(await match([homework, null, egAr, g2, "online"])).toEqual([OTHER_PROVIDER]);
    expect(await match([homework, null, egAr, g3, "online"])).toEqual([]);
  });

  it("lets guests match but refuses someone else's address", async () => {
    await seedProviders();
    const svc = await serviceId("school-subject-tutoring");
    const anon = await tryAsAnon(db, `SELECT * FROM public.match_tutors_for_student($1)`, [svc]);
    expect(anon.ok).toBe(true);
    const anonAddress = await tryAsAnon(
      db,
      `SELECT * FROM public.match_tutors_for_student($1, NULL, NULL, NULL, 'in_person', $2)`,
      [svc, IDS.addressInZone],
    );
    expect(anonAddress.ok).toBe(false);
    expect(anonAddress.error).toMatch(/MATCH_INVALID_ADDRESS/);
    const other = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT * FROM public.match_tutors_for_student($1, NULL, NULL, NULL, 'in_person', $2)`,
      [svc, IDS.addressInZone],
    );
    expect(other.ok).toBe(false);
    const own = await tryAsUser(
      db,
      IDS.customer,
      `SELECT * FROM public.match_tutors_for_student($1, NULL, NULL, NULL, 'in_person', $2)`,
      [svc, IDS.addressInZone],
    );
    expect(own.ok).toBe(true);
  });

  it("marks a grade the owner sets as confirmed for this school year", async () => {
    await seedDraftProvider(db);
    const egAr = await id("teaching_curricula", "eg_national_ar");
    const g3 = await id("teaching_levels", "g3");
    await db.query(
      `UPDATE public.family_members SET education_curriculum_id = $1, education_level_id = $2 WHERE id = $3`,
      [egAr, g3, IDS.childMember],
    );
    const rows = await queryRows<{ confirmed: number; year: number }>(
      db,
      `SELECT grade_confirmed_for_year AS confirmed, public.current_school_year() AS year
         FROM public.family_members WHERE id = $1`,
      [IDS.childMember],
    );
    expect(rows[0]!.confirmed).toBe(rows[0]!.year);

    // confirm_student_grade only works on the caller's own child.
    await db.query(`UPDATE public.family_members SET grade_confirmed_for_year = 2000 WHERE id = $1`, [IDS.childMember]);
    const stranger = await tryAsUser(db, IDS.providerUser, `SELECT public.confirm_student_grade($1)`, [IDS.childMember]);
    expect(stranger.ok).toBe(false);
    const owner = await tryAsUser(db, IDS.customer, `SELECT public.confirm_student_grade($1)`, [IDS.childMember]);
    expect(owner.ok).toBe(true);
    const after = await queryRows<{ confirmed: number; year: number }>(
      db,
      `SELECT grade_confirmed_for_year AS confirmed, public.current_school_year() AS year
         FROM public.family_members WHERE id = $1`,
      [IDS.childMember],
    );
    expect(after[0]!.confirmed).toBe(after[0]!.year);
  });

  it("advances grades once per school year: kg -> g1, g12 stays, confirmed children are skipped", async () => {
    await seedDraftProvider(db);
    const egAr = await id("teaching_curricula", "eg_national_ar");
    const kg = await id("teaching_levels", "kg");
    const g12 = await id("teaching_levels", "g12");
    const g4 = await id("teaching_levels", "g4");
    const g5 = await id("teaching_levels", "g5");
    const year = (await queryRows<{ y: number }>(db, `SELECT public.current_school_year() AS y`))[0]!.y;

    await db.exec(`
      INSERT INTO public.family_members (id, customer_id, full_name, relationship, date_of_birth, is_active)
      VALUES
        ('00000000-0000-0000-0000-00000000a621', '${IDS.customer}', 'Kid KG', 'son', DATE '2021-01-01', true),
        ('00000000-0000-0000-0000-00000000a622', '${IDS.customer}', 'Kid G12', 'son', DATE '2008-01-01', true),
        ('00000000-0000-0000-0000-00000000a623', '${IDS.customer}', 'Kid Confirmed', 'son', DATE '2016-01-01', true);
    `);
    await db.query(
      `UPDATE public.family_members SET education_curriculum_id = $1,
         education_level_id = CASE id
           WHEN $2::uuid THEN $5::uuid WHEN $3::uuid THEN $6::uuid WHEN $4::uuid THEN $7::uuid ELSE $7::uuid END
       WHERE id IN ($2, $3, $4, $8)`,
      [
        egAr,
        "00000000-0000-0000-0000-00000000a621",
        "00000000-0000-0000-0000-00000000a622",
        "00000000-0000-0000-0000-00000000a623",
        kg,
        g12,
        g4,
        IDS.childMember,
      ],
    );
    // Everyone was set last year except the confirmed child.
    await db.query(
      `UPDATE public.family_members SET grade_confirmed_for_year = $1 - 1
        WHERE id IN ('00000000-0000-0000-0000-00000000a621', '00000000-0000-0000-0000-00000000a622', $2)`,
      [year, IDS.childMember],
    );
    await db.query(
      `UPDATE public.family_members SET grade_confirmed_for_year = $1 WHERE id = '00000000-0000-0000-0000-00000000a623'`,
      [year],
    );
    // Last advance was last school year.
    await db.query(
      `UPDATE public.settings SET value = jsonb_build_object('last_advanced_year', $1::int - 1)
        WHERE key = 'student_grade_advance'`,
      [year],
    );

    const first = await asServiceRole(db, () =>
      queryRows<{ r: { status: string; children: number } }>(db, `SELECT public.advance_student_grades() AS r`),
    );
    expect(first[0]!.r.status).toBe("advanced");
    expect(first[0]!.r.children).toBe(2);

    const levels = await queryRows<{ id: string; code: string; confirmed: number | null }>(
      db,
      `SELECT fm.id, l.code, fm.grade_confirmed_for_year AS confirmed
         FROM public.family_members fm JOIN public.teaching_levels l ON l.id = fm.education_level_id
        WHERE fm.customer_id = $1 ORDER BY fm.id`,
      [IDS.customer],
    );
    const byId = Object.fromEntries(levels.map((r) => [r.id, r]));
    expect(byId[IDS.childMember]!.code).toBe("g5");
    expect(byId["00000000-0000-0000-0000-00000000a621"]!.code).toBe("g1");
    expect(byId["00000000-0000-0000-0000-00000000a622"]!.code).toBe("g12");
    expect(byId["00000000-0000-0000-0000-00000000a623"]!.code).toBe("g4");
    // The advance itself does not count as the parent's confirmation.
    expect(byId[IDS.childMember]!.confirmed).toBe(year - 1);
    expect(g5).toBeTruthy();

    const notes = await queryRows<{ body_ar: string; deep_link: string }>(
      db,
      `SELECT body_ar, deep_link FROM public.notifications
        WHERE user_id = $1 AND type = 'student_grade_advanced' ORDER BY body_ar`,
      [IDS.customer],
    );
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.body_ar)).toContain("Child بقى في 5 ابتدائي، صح؟");
    expect(notes[0]!.deep_link).toMatch(/^\/account\/students\?confirm=/);

    // A second run in the same school year does nothing.
    const second = await asServiceRole(db, () =>
      queryRows<{ r: { status: string } }>(db, `SELECT public.advance_student_grades() AS r`),
    );
    expect(second[0]!.r.status).toBe("already_done");
    const again = await queryRows<{ code: string }>(
      db,
      `SELECT l.code FROM public.family_members fm JOIN public.teaching_levels l ON l.id = fm.education_level_id
        WHERE fm.id = $1`,
      [IDS.childMember],
    );
    expect(again[0]!.code).toBe("g5");
  });

  it("keeps the advance away from end users; admin can run it", async () => {
    await seedDraftProvider(db);
    const grants = await queryRows<Record<string, boolean>>(
      db,
      `SELECT has_function_privilege('authenticated', 'public.advance_student_grades()', 'EXECUTE') AS adv_auth,
              has_function_privilege('anon', 'public.advance_student_grades()', 'EXECUTE') AS adv_anon,
              has_function_privilege('authenticated', 'public.admin_tutors_missing_teaching_data_ids()', 'EXECUTE') AS ids_auth,
              has_function_privilege('authenticated', 'public.tg_notify_tutor_demand_on_capability()', 'EXECUTE') AS trg_auth,
              has_function_privilege('anon', 'public.request_tutor_availability(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE') AS req_anon`,
    );
    expect(grants[0]).toEqual({ adv_auth: false, adv_anon: false, ids_auth: false, trg_auth: false, req_anon: false });

    const customer = await tryAsUser(db, IDS.customer, `SELECT public.admin_run_student_grade_advance()`);
    expect(customer.ok).toBe(false);
    const admin = await tryAsUser(db, IDS.adminUser, `SELECT public.admin_run_student_grade_advance() AS r`);
    expect(admin.ok).toBe(true);
    // Seeded with this school year, so a manual run now changes nothing.
    expect((admin.rows?.[0] as { r: { status: string } }).r.status).toBe("already_done");
  });

  it("records «بلغني» once, caps it per day and tells the customer when a tutor is approved", async () => {
    await seedProviders();
    const svc = await serviceId("school-subject-tutoring");
    const subject = await subjectFor(svc);
    const british = await id("teaching_curricula", "british");
    const g4 = await id("teaching_levels", "g4");

    const first = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.request_tutor_availability($1, $2, $3, $4, 'online', $5) AS r`,
      [svc, subject, british, g4, IDS.childMember],
    );
    expect(first.ok).toBe(true);
    expect((first.rows?.[0] as { r: { status: string } }).r.status).toBe("recorded");
    const dup = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.request_tutor_availability($1, $2, $3, $4, 'online', $5) AS r`,
      [svc, subject, british, g4, IDS.childMember],
    );
    expect((dup.rows?.[0] as { r: { status: string } }).r.status).toBe("already_requested");

    // Someone else's child is refused; anon is refused.
    const stranger = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.request_tutor_availability($1, $2, $3, $4, 'online', $5)`,
      [svc, subject, british, g4, IDS.childMember],
    );
    expect(stranger.ok).toBe(false);
    const anon = await tryAsAnon(db, `SELECT public.request_tutor_availability($1)`, [svc]);
    expect(anon.ok).toBe(false);

    // Owner reads their own row; another user sees nothing; only admin gets the summary.
    const ownRows = await tryAsUser(db, IDS.customer, `SELECT id FROM public.tutor_demand_requests`);
    expect(ownRows.rows).toHaveLength(1);
    const otherRows = await tryAsUser(db, IDS.providerUser, `SELECT id FROM public.tutor_demand_requests`);
    expect(otherRows.rows).toHaveLength(0);
    const direct = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.tutor_demand_requests (customer_id, service_id) VALUES ($1, $2)`,
      [IDS.customer, svc],
    );
    expect(direct.ok).toBe(false);
    const deniedSummary = await tryAsUser(db, IDS.customer, `SELECT * FROM public.admin_tutor_demand_summary()`);
    expect(deniedSummary.ok).toBe(false);
    const summary = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT open_requests::int AS n, level_label_en FROM public.admin_tutor_demand_summary()`,
    );
    expect(summary.rows).toEqual([{ n: 1, level_label_en: "Year 5" }]);

    // A pending capability does not notify; approving a matching one does, once.
    await capability({ provider: OTHER_PROVIDER, service: svc, subject, curriculum: british, level: g4, status: "pending" });
    const before = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND type = 'tutor_demand_available'`,
      [IDS.customer],
    );
    expect(before[0]!.n).toBe(0);
    await db.query(
      `UPDATE public.provider_teaching_capabilities SET status = 'approved'
        WHERE provider_id = $1 AND service_id = $2`,
      [OTHER_PROVIDER, svc],
    );
    const after = await queryRows<{ n: number; notified: boolean }>(
      db,
      `SELECT (SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND type = 'tutor_demand_available') AS n,
              (SELECT notified_at IS NOT NULL FROM public.tutor_demand_requests WHERE customer_id = $1) AS notified`,
      [IDS.customer],
    );
    expect(after[0]).toEqual({ n: 1, notified: true });

    // Rate limit: 10 a day.
    const levels = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.teaching_levels WHERE code ~ '^g([0-9]+)$' ORDER BY sort_order LIMIT 11`,
    );
    let limited = false;
    for (const level of levels) {
      const res = await tryAsUser(
        db,
        IDS.customer,
        `SELECT public.request_tutor_availability($1, $2, $3, $4, 'in_person')`,
        [svc, subject, british, level.id],
      );
      if (!res.ok) {
        expect(res.error).toMatch(/DEMAND_RATE_LIMITED/);
        limited = true;
      }
    }
    expect(limited).toBe(true);
  });

  it("counts approved tutors with no approved subjects / grades and lists the same tutors", async () => {
    await seedProviders();
    const svc = await serviceId("school-subject-tutoring");
    const subject = await subjectFor(svc);
    const british = await id("teaching_curricula", "british");
    const g4 = await id("teaching_levels", "g4");
    // Approval needs a subject + grade on file; it is still waiting for review.
    await capability({ provider: OTHER_PROVIDER, service: svc, subject, curriculum: british, level: g4, status: "pending" });
    await db.query("SELECT set_config('app.provider_service_request', '1', true)");
    await db.query(
      `INSERT INTO public.provider_services (provider_id, service_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (provider_id, service_id) DO NOTHING`,
      [OTHER_PROVIDER, svc],
    );
    await db.query("SELECT set_config('app.provider_service_request', '', true)");
    const approved = await tryAsUser(
      db,
      IDS.adminUser,
      `UPDATE public.provider_services SET status = 'approved' WHERE provider_id = $1 AND service_id = $2`,
      [OTHER_PROVIDER, svc],
    );
    expect(approved.error ?? "").toBe("");

    const counts = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT item_count::int AS n FROM public.admin_work_queue_counts() WHERE queue = 'tutors_missing_teaching_data'`,
    );
    expect(counts.ok).toBe(true);
    const ids = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT provider_id FROM public.admin_work_queue_provider_ids('tutors_missing_teaching_data')`,
    );
    expect(ids.ok).toBe(true);
    expect(ids.rows).toHaveLength((counts.rows?.[0] as { n: number }).n);
    expect(ids.rows?.map((r) => r.provider_id)).toContain(OTHER_PROVIDER);

    // Once a subject / grade is approved the tutor leaves the queue.
    await db.query(
      `UPDATE public.provider_teaching_capabilities SET status = 'approved' WHERE provider_id = $1 AND service_id = $2`,
      [OTHER_PROVIDER, svc],
    );
    const afterIds = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT provider_id FROM public.admin_work_queue_provider_ids('tutors_missing_teaching_data')`,
    );
    expect(afterIds.rows?.map((r) => r.provider_id)).not.toContain(OTHER_PROVIDER);

    const customer = await tryAsUser(
      db,
      IDS.customer,
      `SELECT provider_id FROM public.admin_work_queue_provider_ids('tutors_missing_teaching_data')`,
    );
    expect(customer.ok).toBe(false);
  });
});
