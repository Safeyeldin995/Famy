import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BOOKING_END,
  BOOKING_START,
  createDisposableDb,
  functionExecuteAllowed,
  IDS as BASE_IDS,
  queryRows,
  readMigration,
  seedIdentities,
  tablePrivilegeMatrix,
  tryAsUser,
} from "./babysitting-capabilities-harness";

export const TUTORING_MIGRATION = "20261001130000_tutoring_teaching_capabilities.sql";

const IDS = {
  ...BASE_IDS,
  tutoringCategory: "00000000-0000-0000-0000-000000000213",
  homeworkService: "00000000-0000-0000-0000-000000000313",
  schoolService: "00000000-0000-0000-0000-000000000314",
  languageService: "00000000-0000-0000-0000-000000000315",
};

const EXTRA_SCHEMA_SQL = `
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS vacation_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS price_commission_percent numeric(5,2);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS price_commission_amount numeric(10,2);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS price_provider_net numeric(10,2);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_customer_idempotency_unique
  ON public.bookings (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_not_suspended(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
) RETURNS TABLE (is_eligible boolean, failure_reasons text[])
LANGUAGE sql STABLE AS $$
  SELECT true, ARRAY[]::text[];
$$;
`;

async function seedTutoringCatalog(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO public.categories (id, slug) VALUES ('${IDS.tutoringCategory}', 'tutoring')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.services (
      id, category_id, is_active, pricing_model, slug, minimum_price, maximum_price
    ) VALUES
      ('${IDS.homeworkService}', '${IDS.tutoringCategory}', true, 'hourly', 'homework-support', 300, 1500),
      ('${IDS.schoolService}', '${IDS.tutoringCategory}', true, 'hourly', 'school-subject-tutoring', 300, 1500),
      ('${IDS.languageService}', '${IDS.tutoringCategory}', true, 'hourly', 'language-tutoring', 300, 1500)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.provider_services (provider_id, service_id, status, price_override) VALUES
      ('${IDS.provider}', '${IDS.homeworkService}', 'approved', 999),
      ('${IDS.provider}', '${IDS.schoolService}', 'approved', 999),
      ('${IDS.otherProvider}', '${IDS.schoolService}', 'approved', 999),
      ('${IDS.providerAdminProvider}', '${IDS.schoolService}', 'approved', 999)
    ON CONFLICT DO NOTHING;
    INSERT INTO public.zone_services (zone_id, service_id) VALUES
      ('${IDS.zone}', '${IDS.homeworkService}'),
      ('${IDS.zone}', '${IDS.schoolService}'),
      ('${IDS.zone}', '${IDS.languageService}')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.zone_providers (zone_id, provider_id) VALUES
      ('${IDS.zone}', '${IDS.otherProvider}'),
      ('${IDS.zone}', '${IDS.providerAdminProvider}')
    ON CONFLICT DO NOTHING;
  `);
}

async function applyTutoringMigration(db: PGlite): Promise<void> {
  await db.exec(readMigration(TUTORING_MIGRATION));
}

async function attachBookingTrigger(db: PGlite): Promise<void> {
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
  `);
}

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(EXTRA_SCHEMA_SQL);
  await seedIdentities(db);
  await seedTutoringCatalog(db);
  await applyBabysittingMigration(db);
  await applyTutoringMigration(db);
  await attachBookingTrigger(db);
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

async function approveCapability(
  db: PGlite,
  args: {
    providerId?: string;
    serviceId?: string;
    subject?: string;
    curriculum?: string;
    level?: string;
    duration?: number;
    price?: number;
    reviewer?: string;
  } = {},
): Promise<string> {
  const serviceId = args.serviceId ?? IDS.schoolService;
  const subjectId = await taxonomyId(db, "teaching_subjects", args.subject ?? "math");
  const curriculumId = await taxonomyId(
    db,
    "teaching_curricula",
    args.curriculum ?? "eg_national_ar",
  );
  const levelId = await taxonomyId(db, "teaching_levels", args.level ?? "g10");
  const owner =
    args.providerId === IDS.otherProvider
      ? IDS.otherProviderUser
      : args.providerId === IDS.providerAdminProvider
        ? IDS.providerAdminUser
        : IDS.providerUser;
  const upsert = await asUser(db, owner, async () =>
    queryRows<{ provider_upsert_teaching_capability: string }>(
      db,
      `SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,$5,$6,NULL) AS provider_upsert_teaching_capability`,
      [serviceId, subjectId, curriculumId, levelId, args.duration ?? 120, args.price ?? 400],
    ),
  );
  const id = upsert[0]?.provider_upsert_teaching_capability;
  if (!id) throw new Error("upsert did not return an id");
  await asUser(db, args.reviewer ?? IDS.adminUser, async () => {
    await db.query(`SELECT public.admin_review_teaching_capability($1, 'approved', 'ok')`, [id]);
  });
  return id;
}

async function createBooking(
  db: PGlite,
  args: {
    userId?: string;
    providerId?: string;
    serviceId?: string;
    familyMemberId?: string | null;
    start?: string;
    end?: string;
    capabilityId?: string | null;
    subject?: string | null;
    curriculum?: string | null;
    level?: string | null;
  } = {},
): Promise<{ ok: boolean; error?: string; bookingId?: string; subtotal?: number }> {
  const result = await tryAsUser(
    db,
    args.userId ?? IDS.customer,
    `SELECT public.create_booking(
        $1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(),
        $6, NULL, NULL, '[]'::jsonb, $7, $8, $9, $10
      ) AS payload`,
    [
      args.providerId ?? IDS.provider,
      args.serviceId ?? IDS.schoolService,
      IDS.address,
      args.start ?? BOOKING_START,
      args.end ?? BOOKING_END,
      args.familyMemberId === undefined ? null : args.familyMemberId,
      args.capabilityId ?? null,
      args.subject ?? null,
      args.curriculum ?? null,
      args.level ?? null,
    ],
  );
  if (!result.ok) return { ok: false, error: result.error };
  const payload = result.rows?.[0]?.payload as { booking_id?: string } | undefined;
  const bookingId = payload?.booking_id;
  if (!bookingId) return { ok: false, error: JSON.stringify(result.rows) };
  const booked = await queryRows<{ price_subtotal: number }>(
    db,
    `SELECT price_subtotal FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  return { ok: true, bookingId, subtotal: Number(booked[0]?.price_subtotal) };
}

describe("tutoring teaching capabilities", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("seeds the launch taxonomy idempotently without duplicates", async () => {
    db = await readyDb();
    await applyTutoringMigration(db);
    const subjects = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.teaching_subjects`,
    );
    const curricula = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.teaching_curricula`,
    );
    const levels = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.teaching_levels`,
    );
    const links = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.teaching_subject_services`,
    );
    expect(subjects[0]?.n).toBe(16);
    expect(curricula[0]?.n).toBe(7);
    expect(levels[0]?.n).toBe(13);
    expect(links[0]?.n).toBe(20);
    const math = await queryRows<{ max_session_duration_min: number }>(
      db,
      `SELECT max_session_duration_min FROM public.teaching_subjects WHERE code = 'math'`,
    );
    const science = await queryRows<{ max_session_duration_min: number }>(
      db,
      `SELECT max_session_duration_min FROM public.teaching_subjects WHERE code = 'science'`,
    );
    expect(math[0]?.max_session_duration_min).toBe(180);
    expect(science[0]?.max_session_duration_min).toBe(120);
    const prices = await queryRows<{ minimum_price: number; maximum_price: number }>(
      db,
      `SELECT minimum_price, maximum_price FROM public.services WHERE slug = 'school-subject-tutoring'`,
    );
    expect(Number(prices[0]?.minimum_price)).toBe(300);
    expect(Number(prices[0]?.maximum_price)).toBe(1500);
  });

  it("rejects unapproved, foreign, mismatched, and invalid tutoring bookings", async () => {
    db = await readyDb();
    const pendingId = await asUser(db, IDS.providerUser, async () => {
      const subjectId = await taxonomyId(db!, "teaching_subjects", "math");
      const curriculumId = await taxonomyId(db!, "teaching_curricula", "eg_national_ar");
      const levelId = await taxonomyId(db!, "teaching_levels", "g10");
      const rows = await queryRows<{ provider_upsert_teaching_capability: string }>(
        db!,
        `SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,120,400,NULL) AS provider_upsert_teaching_capability`,
        [IDS.schoolService, subjectId, curriculumId, levelId],
      );
      return rows[0]!.provider_upsert_teaching_capability;
    });

    const unapproved = await createBooking(db, {
      capabilityId: pendingId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(unapproved.ok).toBe(false);
    expect(unapproved.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const foreignCap = await approveCapability(db, { providerId: IDS.otherProvider });
    const foreign = await createBooking(db, {
      capabilityId: foreignCap,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const homeworkCap = await approveCapability(db, {
      serviceId: IDS.homeworkService,
      subject: "homework_all",
    });
    const serviceMismatch = await createBooking(db, {
      capabilityId: homeworkCap,
      serviceId: IDS.schoolService,
      subject: "homework_all",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(serviceMismatch.ok).toBe(false);
    expect(serviceMismatch.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const arabicCap = await approveCapability(db, { subject: "arabic" });
    await db.exec(`
      DELETE FROM public.teaching_subject_services
      WHERE subject_id = (SELECT id FROM public.teaching_subjects WHERE code = 'arabic')
        AND service_id = '${IDS.schoolService}'
    `);
    const unlinked = await createBooking(db, {
      capabilityId: arabicCap,
      subject: "arabic",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(unlinked.ok).toBe(false);
    expect(unlinked.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const mathCap = await approveCapability(db);
    const codeMismatch = await createBooking(db, {
      capabilityId: mathCap,
      subject: "physics",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(codeMismatch.ok).toBe(false);
    expect(codeMismatch.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const wrongDuration = await createBooking(db, {
      capabilityId: mathCap,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
      end: "2026-09-28T13:00:00Z",
    });
    expect(wrongDuration.ok).toBe(false);
    expect(wrongDuration.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("rejects 180 minutes for a 120-capped subject at upsert and at booking", async () => {
    db = await readyDb();
    const subjectId = await taxonomyId(db, "teaching_subjects", "science");
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(db, "teaching_levels", "g6");
    const upsert = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,180,400,NULL)`,
      [IDS.schoolService, subjectId, curriculumId, levelId],
    );
    expect(upsert.ok).toBe(false);
    expect(upsert.error).toMatch(/TEACHING_INVALID_DURATION/);

    const capId = await approveCapability(db, { subject: "science", level: "g6", duration: 120 });
    await db.exec(`
      UPDATE public.provider_teaching_capabilities
      SET session_duration_min = 180, status = 'approved'
      WHERE id = '${capId}'
    `);
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "science",
      curriculum: "eg_national_ar",
      level: "g6",
      end: "2026-09-28T13:00:00Z",
    });
    expect(booked.ok).toBe(false);
    expect(booked.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("accepts 180 minutes for math and snapshots price independently of hourly_rate", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { duration: 180, price: 600 });
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
      start: BOOKING_START,
      end: "2026-09-28T13:00:00Z",
    });
    expect(booked.ok).toBe(true);
    expect(booked.subtotal).toBe(600);
    const snap = await queryRows<{
      session_duration_min: number;
      teaching_subject_code: string;
      teaching_subject_name_en: string;
    }>(
      db,
      `SELECT session_duration_min, teaching_subject_code, teaching_subject_name_en
       FROM public.bookings WHERE id = $1`,
      [booked.bookingId],
    );
    expect(snap[0]?.session_duration_min).toBe(180);
    expect(snap[0]?.teaching_subject_code).toBe("math");
    expect(snap[0]?.teaching_subject_name_en).toBe("Mathematics");
  });

  it("rejects booking and upsert when subject, curriculum, or level is inactive", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { price: 400 });
    await db.exec(`UPDATE public.teaching_subjects SET is_active = false WHERE code = 'math'`);
    const bookedInactiveSubject = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(bookedInactiveSubject.ok).toBe(false);
    expect(bookedInactiveSubject.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    await db.exec(`UPDATE public.teaching_subjects SET is_active = true WHERE code = 'math'`);
    await db.exec(
      `UPDATE public.teaching_curricula SET is_active = false WHERE code = 'eg_national_ar'`,
    );
    const bookedInactiveCurriculum = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(bookedInactiveCurriculum.ok).toBe(false);
    expect(bookedInactiveCurriculum.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    await db.exec(
      `UPDATE public.teaching_curricula SET is_active = true WHERE code = 'eg_national_ar'`,
    );
    await db.exec(`UPDATE public.teaching_levels SET is_active = false WHERE code = 'g10'`);
    const bookedInactiveLevel = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(bookedInactiveLevel.ok).toBe(false);
    expect(bookedInactiveLevel.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);

    const subjectId = await taxonomyId(db, "teaching_subjects", "physics");
    const curriculumId = await taxonomyId(db, "teaching_curricula", "eg_national_ar");
    const levelId = await taxonomyId(db, "teaching_levels", "g10");
    const upsert = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,120,400,NULL)`,
      [IDS.schoolService, subjectId, curriculumId, levelId],
    );
    expect(upsert.ok).toBe(false);
    expect(upsert.error).toMatch(/TEACHING_SUBJECT_NOT_LINKED/);
  });

  it("rejects a price that falls outside min/max after an admin changes the limits", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { price: 400 });
    await db.exec(
      `UPDATE public.services SET minimum_price = 800 WHERE id = '${IDS.schoolService}'`,
    );
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(booked.ok).toBe(false);
    expect(booked.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("rejects booking after an approved capability is edited back to pending", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { price: 400 });
    await asUser(db, IDS.providerUser, async () => {
      const subjectId = await taxonomyId(db!, "teaching_subjects", "math");
      const curriculumId = await taxonomyId(db!, "teaching_curricula", "eg_national_ar");
      const levelId = await taxonomyId(db!, "teaching_levels", "g10");
      await db!.query(`SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,120,500,$5)`, [
        IDS.schoolService,
        subjectId,
        curriculumId,
        levelId,
        capId,
      ]);
    });
    const status = await queryRows<{ status: string }>(
      db,
      `SELECT status FROM public.provider_teaching_capabilities WHERE id = $1`,
      [capId],
    );
    expect(status[0]?.status).toBe("pending");
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(booked.ok).toBe(false);
    expect(booked.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("rejects Book Again when the capability is suspended", async () => {
    db = await readyDb();
    const capId = await approveCapability(db);
    await asUser(db, IDS.adminUser, async () => {
      await db!.query(`SELECT public.admin_review_teaching_capability($1, 'suspended', 'pause')`, [
        capId,
      ]);
    });
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(booked.ok).toBe(false);
    expect(booked.error).toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("accepts self and family-member tutoring bookings with a valid capability", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { price: 350 });
    const self = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
      familyMemberId: null,
    });
    expect(self.ok).toBe(true);
    expect(self.subtotal).toBe(350);
    const family = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
      familyMemberId: IDS.teenMember,
      start: "2026-09-29T10:00:00Z",
      end: "2026-09-29T12:00:00Z",
    });
    expect(family.ok).toBe(true);
    expect(family.subtotal).toBe(350);
  });

  it("keeps the booking snapshot after a later capability edit", async () => {
    db = await readyDb();
    const capId = await approveCapability(db, { duration: 120, price: 400 });
    const booked = await createBooking(db, {
      capabilityId: capId,
      subject: "math",
      curriculum: "eg_national_ar",
      level: "g10",
    });
    expect(booked.ok).toBe(true);
    await asUser(db, IDS.providerUser, async () => {
      const subjectId = await taxonomyId(db!, "teaching_subjects", "math");
      const curriculumId = await taxonomyId(db!, "teaching_curricula", "eg_national_ar");
      const levelId = await taxonomyId(db!, "teaching_levels", "g10");
      await db!.query(`SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,90,900,$5)`, [
        IDS.schoolService,
        subjectId,
        curriculumId,
        levelId,
        capId,
      ]);
    });
    const snap = await queryRows<{
      session_duration_min: number;
      price_subtotal: number;
      teaching_subject_code: string;
    }>(
      db,
      `SELECT session_duration_min, price_subtotal, teaching_subject_code FROM public.bookings WHERE id = $1`,
      [booked.bookingId],
    );
    expect(snap[0]?.session_duration_min).toBe(120);
    expect(Number(snap[0]?.price_subtotal)).toBe(400);
    expect(snap[0]?.teaching_subject_code).toBe("math");
    const locked = await db
      .query(
        `UPDATE public.bookings SET session_duration_min = 90, price_subtotal = 1 WHERE id = $1`,
        [booked.bookingId],
      )
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    expect(locked.ok).toBe(false);
    expect(locked.ok === false ? locked.error : "").toMatch(/snapshot|cannot be changed/i);
  });

  it("blocks provider status writes, self-approval, and customer review_note reads", async () => {
    db = await readyDb();
    const capId = await approveCapability(db);
    const statusWrite = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.provider_teaching_capabilities SET status = 'approved' WHERE id = $1`,
      [capId],
    );
    expect(statusWrite.ok).toBe(false);

    const ownCap = await asUser(db, IDS.providerAdminUser, async () => {
      const subjectId = await taxonomyId(db!, "teaching_subjects", "math");
      const curriculumId = await taxonomyId(db!, "teaching_curricula", "eg_national_ar");
      const levelId = await taxonomyId(db!, "teaching_levels", "g10");
      const rows = await queryRows<{ provider_upsert_teaching_capability: string }>(
        db!,
        `SELECT public.provider_upsert_teaching_capability($1,$2,$3,$4,120,400,NULL) AS provider_upsert_teaching_capability`,
        [IDS.schoolService, subjectId, curriculumId, levelId],
      );
      return rows[0]!.provider_upsert_teaching_capability;
    });
    const selfReview = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `SELECT public.admin_review_teaching_capability($1, 'approved', 'self')`,
      [ownCap],
    );
    expect(selfReview.ok).toBe(false);
    expect(selfReview.error).toMatch(/TEACHING_SELF_REVIEW/);

    const noteRead = await tryAsUser(
      db,
      IDS.customer,
      `SELECT review_note FROM public.provider_teaching_capabilities WHERE id = $1`,
      [capId],
    );
    expect(noteRead.ok).toBe(false);

    const authenticatedInsert = await tablePrivilegeMatrix(db, "provider_teaching_capabilities");
    const insertAllowed = authenticatedInsert.find(
      (row) => row.grantee === "authenticated" && row.privilege === "INSERT",
    );
    expect(insertAllowed?.allowed).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "anon",
        "public.provider_upsert_teaching_capability(uuid, uuid, uuid, uuid, integer, integer, uuid)",
      ),
    ).toBe(false);
  });

  it("keeps hourly babysitting-adjacent pricing for non-tutoring services", async () => {
    db = await readyDb();
    const booked = await createBooking(db, {
      serviceId: IDS.cleaningService,
      capabilityId: null,
      subject: null,
      curriculum: null,
      level: null,
    });
    expect(booked.ok).toBe(true);
    expect(booked.subtotal).toBe(200);
  });
});
