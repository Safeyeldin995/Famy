import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
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
const SECOND_CUSTOMER = "00000000-0000-0000-0000-00000000a002";
const THIRD_CUSTOMER = "00000000-0000-0000-0000-00000000a003";

type Insight = {
  service_id: string;
  subject_id: string | null;
  curriculum_id: string | null;
  level_id: string | null;
  service_mode: string;
  governorate_code: string | null;
  students: number;
  teaches_subject: boolean;
  capability_status: string | null;
  mode_fits: boolean;
  near_me: boolean;
  level_label_ar: string | null;
};

async function id(table: string, code: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.${table} WHERE code = $1`,
    [code],
  );
  if (!rows[0]) throw new Error(`missing ${table}.${code}`);
  return rows[0].id;
}

async function serviceId(slug: string): Promise<string> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.services WHERE slug = $1`,
    [slug],
  );
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

async function seed() {
  await seedDraftProvider(db);
  await db.exec(`
    SELECT set_config('app.onboarding_status_transition', '1', true);
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.otherProviderUser}', '{"signup_role":"provider","full_name":"Second Tutor"}'),
      ('${SECOND_CUSTOMER}', '{"full_name":"Second Customer"}'),
      ('${THIRD_CUSTOMER}', '{"full_name":"Third Customer"}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, offering_mode)
    VALUES ('${OTHER_PROVIDER}', '${IDS.otherProviderUser}', 150, 'APPROVED', 'both')
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.providers
       SET onboarding_status = 'APPROVED', offering_mode = 'online', governorate = 'giza'
     WHERE id = '${IDS.provider}';
    SELECT set_config('app.onboarding_status_transition', '', true);
  `);
}

async function demand(opts: {
  customer: string;
  service: string;
  subject: string;
  curriculum: string;
  level: string;
  mode?: "online" | "in_person";
  governorate?: string | null;
  familyMember?: string | null;
  daysAgo?: number;
  notified?: boolean;
}) {
  await db.query(
    `INSERT INTO public.tutor_demand_requests
       (customer_id, family_member_id, service_id, subject_id, curriculum_id, level_id,
        service_mode, governorate_code, created_at, notified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(days => $9),
             CASE WHEN $10 THEN now() END)`,
    [
      opts.customer,
      opts.familyMember ?? null,
      opts.service,
      opts.subject,
      opts.curriculum,
      opts.level,
      opts.mode ?? "online",
      opts.governorate ?? null,
      opts.daysAgo ?? 0,
      opts.notified ?? false,
    ],
  );
}

async function insights(user: string): Promise<Insight[]> {
  const res = await tryAsUser(db, user, `SELECT * FROM public.provider_tutor_demand_insights()`);
  if (!res.ok) throw new Error(String(res.error));
  return (res.rows ?? []) as Insight[];
}

describe("provider_tutor_demand_insights («الطلبة بيدوروا على إيه»)", () => {
  it("is for approved providers only and never returns customer data", async () => {
    await seed();
    const anon = await tryAsAnon(db, `SELECT * FROM public.provider_tutor_demand_insights()`);
    expect(anon.ok).toBe(false);
    const customer = await tryAsUser(
      db,
      IDS.customer,
      `SELECT * FROM public.provider_tutor_demand_insights()`,
    );
    expect(customer.ok).toBe(false);
    expect(String(customer.error)).toMatch(/DEMAND_PROVIDER_NOT_APPROVED/);

    await db.exec(`
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'SUBMITTED' WHERE id = '${IDS.provider}';
      SELECT set_config('app.onboarding_status_transition', '', true);
    `);
    const notApproved = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT * FROM public.provider_tutor_demand_insights()`,
    );
    expect(notApproved.ok).toBe(false);

    const cols = await queryRows<{ name: string }>(
      db,
      `SELECT unnest(proargnames) AS name FROM pg_proc WHERE proname = 'provider_tutor_demand_insights'`,
    );
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("customer_id");
    expect(names).not.toContain("family_member_id");

    const grants = await queryRows<{
      anon: boolean;
      auth: boolean;
      definer: boolean;
      path: string[] | null;
    }>(
      db,
      `SELECT has_function_privilege('anon', 'public.provider_tutor_demand_insights()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.provider_tutor_demand_insights()', 'EXECUTE') AS auth,
              p.prosecdef AS definer, p.proconfig AS path
         FROM pg_proc p WHERE p.proname = 'provider_tutor_demand_insights'`,
    );
    expect(grants[0]).toMatchObject({ anon: false, auth: true, definer: true });
    expect(grants[0]!.path).toContain("search_path=public");
  });

  it("aggregates students, hides a lone family's governorate and skips old or answered requests", async () => {
    await seed();
    const svc = await serviceId("school-subject-tutoring");
    const subject = await subjectFor(svc);
    const british = await id("teaching_curricula", "british");
    const g4 = await id("teaching_levels", "g4");
    const g5 = await id("teaching_levels", "g5");
    const base = { service: svc, subject, curriculum: british };

    // Online g4: the same parent for two children, plus a second parent = 3 students.
    await demand({ ...base, level: g4, customer: IDS.customer, familyMember: IDS.childMember });
    await demand({ ...base, level: g4, customer: IDS.customer, familyMember: null });
    await demand({ ...base, level: g4, customer: SECOND_CUSTOMER });
    // In person g5 in Giza by one family only: the governorate is withheld.
    await demand({
      ...base,
      level: g5,
      mode: "in_person",
      governorate: "giza",
      customer: IDS.customer,
    });
    // Old and already-answered requests don't count.
    await demand({ ...base, level: g5, customer: THIRD_CUSTOMER, daysAgo: 120 });
    await demand({ ...base, level: g5, customer: SECOND_CUSTOMER, notified: true });

    let rows = await insights(IDS.providerUser);
    const online = rows.find((r) => r.level_id === g4 && r.service_mode === "online");
    expect(online).toMatchObject({ students: 3, governorate_code: null, mode_fits: true });
    expect(online!.level_label_ar).toBeTruthy();
    const home = rows.filter((r) => r.level_id === g5);
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({
      service_mode: "in_person",
      governorate_code: null,
      students: 1,
      near_me: false,
      // This tutor only teaches online.
      mode_fits: false,
    });

    // A second family in Giza: now the governorate shows, and it's near this tutor.
    await demand({
      ...base,
      level: g5,
      mode: "in_person",
      governorate: "giza",
      customer: SECOND_CUSTOMER,
    });
    rows = await insights(IDS.providerUser);
    const giza = rows.find((r) => r.level_id === g5 && r.service_mode === "in_person");
    expect(giza).toMatchObject({ governorate_code: "giza", students: 2, near_me: true });
    // This tutor only teaches online, so the bigger online row stays first.
    expect(rows[0]).toMatchObject({ level_id: g4, service_mode: "online", students: 3 });
  });

  it("marks what the tutor teaches, and an approved match notifies customers and drops the row", async () => {
    await seed();
    const svc = await serviceId("school-subject-tutoring");
    const subject = await subjectFor(svc);
    const british = await id("teaching_curricula", "british");
    const g4 = await id("teaching_levels", "g4");
    const g6 = await id("teaching_levels", "g6");
    await demand({ service: svc, subject, curriculum: british, level: g4, customer: IDS.customer });
    await demand({
      service: svc,
      subject,
      curriculum: british,
      level: g6,
      customer: SECOND_CUSTOMER,
    });

    // This tutor has the subject (pending review) for g4 only.
    await db.query(
      `INSERT INTO public.provider_teaching_capabilities
         (provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status)
       VALUES ($1, $2, $3, $4, $5, 60, 400, 'pending')`,
      [IDS.provider, svc, subject, british, g4],
    );
    let rows = await insights(IDS.providerUser);
    expect(rows.find((r) => r.level_id === g4)).toMatchObject({
      teaches_subject: true,
      capability_status: "pending",
    });
    expect(rows.find((r) => r.level_id === g6)).toMatchObject({
      teaches_subject: true,
      capability_status: null,
    });

    // Another tutor gets g6 approved: the waiting customer is told once and the row is gone.
    await db.query(
      `INSERT INTO public.provider_teaching_capabilities
         (provider_id, service_id, subject_id, curriculum_id, level_id, session_duration_min, session_price, status)
       VALUES ($1, $2, $3, $4, $5, 60, 400, 'approved')`,
      [OTHER_PROVIDER, svc, subject, british, g6],
    );
    const notified = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.notifications
        WHERE user_id = $1 AND type = 'tutor_demand_available'`,
      [SECOND_CUSTOMER],
    );
    expect(notified[0]!.n).toBe(1);
    rows = await insights(IDS.providerUser);
    expect(rows.find((r) => r.level_id === g6)).toBeUndefined();
    expect(rows.find((r) => r.level_id === g4)).toBeDefined();
  });
});
