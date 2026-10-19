import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applyDeclarationMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BOOKING_END,
  BOOKING_START,
  CREATE_BOOKING_MIGRATION,
  createDisposableDb,
  extractPublicFunctionSql,
  IDS,
  queryRows,
  RESPOND_RESCHEDULE_MIGRATION,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";

const DECLARATION_FIXTURE_SQL = `
-- Limited unrelated-helper stubs for PGlite. create_booking / respond_reschedule
-- are loaded unchanged from tracked migrations below.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_en text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_ar text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS years_experience int NOT NULL DEFAULT 0;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_public text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_code text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS governorate text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS full_address text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS previous_work text;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS newborn_experience boolean NOT NULL DEFAULT false;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS first_aid_training boolean NOT NULL DEFAULT false;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS accuracy_confirmed_at timestamptz;
ALTER TABLE public.provider_onboarding_details ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.zones ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS currency text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_customer_idempotency_unique
  ON public.bookings (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS requirement_selections jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.provider_services ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS public.provider_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  full_name text,
  relationship text,
  phone text,
  notes text,
  sort_order int
);

CREATE TABLE IF NOT EXISTS public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  type text NOT NULL,
  status text,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
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

CREATE TABLE IF NOT EXISTS public.booking_reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  proposed_start_at timestamptz NOT NULL,
  proposed_end_at timestamptz NOT NULL,
  original_start_at timestamptz,
  original_end_at timestamptz,
  responded_by uuid,
  response_reason text,
  responded_at timestamptz,
  request_reason text,
  responds_to_id uuid
);

CREATE OR REPLACE FUNCTION public.is_phase1_category_slug(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug IN ('home-cleaning', 'babysitting');
$$;

CREATE OR REPLACE FUNCTION public.normalize_reference_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(p_phone), '');
$$;

CREATE OR REPLACE FUNCTION public.assert_onboarding_internal_call()
RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;

CREATE OR REPLACE FUNCTION public.log_provider_onboarding_event(
  p_provider_id uuid, p_actor_id uuid, p_actor_role text, p_action text,
  p_previous_status public.provider_onboarding_status,
  p_new_status public.provider_onboarding_status,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;

CREATE OR REPLACE FUNCTION public.is_not_suspended(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true; $$;

CREATE OR REPLACE FUNCTION public.booking_request_fingerprint(
  p_provider_id uuid, p_service_id uuid, p_address_id uuid,
  p_start_at timestamptz, p_end_at timestamptz, p_family_member_id uuid,
  p_notes text, p_promo_code_id uuid, p_requirement_selections jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', p_provider_id::text, p_service_id::text, p_address_id::text,
    p_start_at::text, p_end_at::text, coalesce(p_family_member_id::text, ''),
    coalesce(p_notes, ''), coalesce(p_promo_code_id::text, ''),
    coalesce(p_requirement_selections::text, '[]'));
$$;

CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (is_eligible boolean)
LANGUAGE sql STABLE AS $$ SELECT true; $$;
`;

const CREATE_BOOKING_SQL = extractPublicFunctionSql(CREATE_BOOKING_MIGRATION, "create_booking");
const RESPOND_RESCHEDULE_SQL = extractPublicFunctionSql(
  RESPOND_RESCHEDULE_MIGRATION,
  "respond_reschedule",
);

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(DECLARATION_FIXTURE_SQL);
  await applyBabysittingMigration(db);
  await applyDeclarationMigration(db);
  await db.exec(CREATE_BOOKING_SQL);
  await db.exec(RESPOND_RESCHEDULE_SQL);
  await db.exec(`
    GRANT UPDATE ON public.providers TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.provider_onboarding_details TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.provider_age_group_capabilities TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
    GRANT INSERT, UPDATE ON public.booking_reschedule_requests TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_onboarding_completion(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_onboarding_snapshot() TO authenticated;
    REVOKE UPDATE (max_children_per_booking) ON public.providers FROM PUBLIC, anon, authenticated;
  `);
  await seedIdentities(db);
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
    UPDATE public.providers SET bio_en = 'Bio', years_experience = 2 WHERE id = '${IDS.provider}';
    INSERT INTO public.provider_onboarding_details (provider_id) VALUES ('${IDS.provider}')
    ON CONFLICT (provider_id) DO NOTHING;
  `);
  return db;
}

describe("babysitting declaration phase B", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("loads unchanged create_booking and respond_reschedule bodies from tracked migrations", () => {
    expect(CREATE_BOOKING_SQL).toContain("hashtextextended(");
    expect(CREATE_BOOKING_SQL).toContain("WHEN unique_violation THEN");
    expect(CREATE_BOOKING_SQL).toContain("WHEN exclusion_violation THEN");
    expect(RESPOND_RESCHEDULE_SQL).toContain("p_action = 'reject'");
    expect(RESPOND_RESCHEDULE_SQL).toContain("counter_proposed");
    expect(RESPOND_RESCHEDULE_SQL).not.toMatch(/hashtext\(/);
  });

  it("saves capabilities through the authenticated RPC and rejects unauthorized callers", async () => {
    db = await readyDb();
    const denied = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          years_experience: 2,
          bio_en: "Bio",
          age_group_capabilities: [{ code: "toddler", years_experience: 1 }],
          max_children_per_booking: 2,
        }),
      ],
    );
    expect(denied.ok).toBe(false);

    const other = await tryAsUser(
      db,
      IDS.otherProviderUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          years_experience: 2,
          bio_en: "Bio",
          age_group_capabilities: [{ code: "toddler" }],
          max_children_per_booking: 2,
        }),
      ],
    );
    expect(other.ok).toBe(true);

    const saved = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_save_onboarding_section: unknown }>(
        db!,
        `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
        [
          JSON.stringify({
            years_experience: 3,
            bio_en: "EN",
            bio_ar: "AR",
            age_group_capabilities: [
              { code: "toddler", years_experience: 4, note: "naps" },
              { code: "infant", years_experience: 1 },
            ],
            max_children_per_booking: 2,
          }),
        ],
      ),
    );
    expect(saved[0]).toBeTruthy();

    const rows = await queryRows<{ age_group_code: string }>(
      db,
      `SELECT age_group_code FROM public.provider_age_group_capabilities WHERE provider_id = $1 ORDER BY 1`,
      [IDS.provider],
    );
    expect(rows.map((row) => row.age_group_code)).toEqual(["infant", "toddler"]);
    const max = await queryRows<{ max_children_per_booking: number }>(
      db,
      `SELECT max_children_per_booking FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(max[0]?.max_children_per_booking).toBe(2);

    const duplicate = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          age_group_capabilities: [{ code: "toddler" }, { code: "toddler" }],
          max_children_per_booking: 1,
        }),
      ],
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error ?? "").toMatch(/Duplicate/i);

    const unknown = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          age_group_capabilities: [{ code: "banana" }],
          max_children_per_booking: 1,
        }),
      ],
    );
    expect(unknown.ok).toBe(false);

    const nullMax = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          age_group_capabilities: [{ code: "toddler" }],
          max_children_per_booking: null,
        }),
      ],
    );
    expect(nullMax.ok).toBe(false);

    const malformed = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          age_group_capabilities: ["toddler"],
          max_children_per_booking: 1,
        }),
      ],
    );
    expect(malformed.ok).toBe(false);

    const snapshot = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_snapshot: Record<string, unknown> }>(
        db!,
        `SELECT public.provider_onboarding_snapshot()`,
      ),
    );
    const snap = snapshot[0]?.provider_onboarding_snapshot;
    expect(snap?.exists).toBe(true);
    expect(
      (snap?.provider as { max_children_per_booking?: number })?.max_children_per_booking,
    ).toBe(2);
    expect(Array.isArray(snap?.age_group_capabilities)).toBe(true);
    expect(snap?.profile).toBeTruthy();
    expect(snap?.details).toBeTruthy();
    expect(snap?.completion).toBeTruthy();
  });

  it("keeps verified rows, mirrors the effective set, and blocks review-state writes for provider-admins", async () => {
    db = await readyDb();
    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db!,
        `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
        [
          JSON.stringify({
            bio_en: "EN",
            age_group_capabilities: [
              { code: "toddler", years_experience: 2 },
              { code: "infant", years_experience: 1 },
            ],
            max_children_per_booking: 2,
          }),
        ],
      );
    });

    await db.exec(`
      UPDATE public.provider_age_group_capabilities
      SET verified_at = now(), verified_by = '${IDS.adminUser}'
      WHERE provider_id = '${IDS.provider}' AND age_group_code = 'toddler'
    `);

    await asUser(db, IDS.providerUser, async () => {
      await queryRows(
        db!,
        `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
        [
          JSON.stringify({
            bio_en: "EN",
            age_group_capabilities: [{ code: "preschool", years_experience: 9, note: "stale" }],
            max_children_per_booking: 3,
          }),
        ],
      );
    });

    const caps = await queryRows<{ age_group_code: string; years_experience: number | null }>(
      db,
      `SELECT age_group_code, years_experience FROM public.provider_age_group_capabilities
       WHERE provider_id = $1 ORDER BY 1`,
      [IDS.provider],
    );
    expect(caps.map((row) => row.age_group_code)).toEqual(["preschool", "toddler"]);
    expect(caps.find((row) => row.age_group_code === "toddler")?.years_experience).toBe(2);

    const mirror = await queryRows<{ child_age_groups: string[] }>(
      db,
      `SELECT child_age_groups FROM public.provider_onboarding_details WHERE provider_id = $1`,
      [IDS.provider],
    );
    expect(mirror[0]?.child_age_groups).toEqual(["toddler", "preschool"]);

    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'SUBMITTED' WHERE id = '${IDS.provider}';
      COMMIT;
    `);
    const submitted = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          max_children_per_booking: 1,
          age_group_capabilities: [{ code: "toddler" }],
        }),
      ],
    );
    expect(submitted.ok).toBe(false);

    const direct = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET max_children_per_booking = 9 WHERE id = $1`,
      [IDS.provider],
    );
    expect(direct.ok).toBe(false);

    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'APPROVED' WHERE id = '${IDS.providerAdminProvider}';
      COMMIT;
    `);
    const adminOwn = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.providers SET max_children_per_booking = 8 WHERE id = $1`,
      [IDS.providerAdminProvider],
    );
    expect(adminOwn.ok).toBe(false);

    const adminOwnRpc = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          max_children_per_booking: 4,
          age_group_capabilities: [{ code: "toddler" }],
        }),
      ],
    );
    expect(adminOwnRpc.ok).toBe(false);

    const adminOther = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `UPDATE public.providers SET max_children_per_booking = 8 WHERE id = $1`,
      [IDS.provider],
    );
    expect(adminOther.ok).toBe(false);

    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'APPROVED' WHERE id = '${IDS.provider}';
      COMMIT;
    `);
    const approvedSave = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          max_children_per_booking: 1,
          age_group_capabilities: [{ code: "toddler" }],
        }),
      ],
    );
    expect(approvedSave.ok).toBe(false);
  });

  it("calls authenticated create_booking and authorized reschedule across age bands", async () => {
    db = await readyDb();
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers
      SET max_children_per_booking = 2, onboarding_status = 'APPROVED', bio_en = 'Bio'
      WHERE id = '${IDS.provider}';
      COMMIT;
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
      UPDATE public.family_members
      SET date_of_birth = DATE '2023-10-28'
      WHERE id = '${IDS.childMember}';
    `);

    const myself = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), NULL)`,
      [IDS.provider, IDS.babysittingService, IDS.address, BOOKING_START, BOOKING_END],
    );
    expect(myself.ok).toBe(false);
    expect(myself.error ?? "").toMatch(/BOOKING_INVALID_BOOKING_REQUEST/);

    const cleaning = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), NULL)`,
      [IDS.provider, IDS.cleaningService, IDS.address, BOOKING_START, BOOKING_END],
    );
    expect(cleaning.ok).toBe(true);

    const created = await asUser(db, IDS.customer, async () =>
      queryRows<{ create_booking: { booking_id: string } }>(
        db!,
        `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), $6)`,
        [
          IDS.provider,
          IDS.babysittingService,
          IDS.address,
          BOOKING_START,
          BOOKING_END,
          IDS.childMember,
        ],
      ),
    );
    const bookingId = created[0]?.create_booking?.booking_id;
    expect(bookingId).toBeTruthy();

    const reqRows = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.booking_reschedule_requests (
         booking_id, status, requested_by, proposed_start_at, proposed_end_at, original_start_at, original_end_at
       ) VALUES ($1, 'pending', $2, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz)
       RETURNING id`,
      [
        bookingId,
        IDS.customer,
        "2026-10-28T10:00:00Z",
        "2026-10-28T12:00:00Z",
        BOOKING_START,
        BOOKING_END,
      ],
    );
    const crossBand = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.respond_reschedule($1::uuid, 'accept')`,
      [reqRows[0]?.id],
    );
    expect(crossBand.ok).toBe(false);
    expect(crossBand.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE|does not support/);

    const rolledBack = await queryRows<{ start_at: string; status: string; req_status: string }>(
      db,
      `SELECT b.start_at::text AS start_at, b.status,
              r.status AS req_status
       FROM public.bookings b
       JOIN public.booking_reschedule_requests r ON r.booking_id = b.id
       WHERE b.id = $1 AND r.id = $2`,
      [bookingId, reqRows[0]?.id],
    );
    expect(rolledBack[0]?.start_at).toContain("2026-09-28");
    expect(rolledBack[0]?.req_status).toBe("pending");

    const rejected = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.respond_reschedule($1::uuid, 'reject', 'outside my hours')`,
      [reqRows[0]?.id],
    );
    expect(rejected.ok).toBe(true);
    const afterReject = await queryRows<{ start_at: string; req_status: string }>(
      db,
      `SELECT b.start_at::text AS start_at, r.status AS req_status
       FROM public.bookings b
       JOIN public.booking_reschedule_requests r ON r.booking_id = b.id
       WHERE b.id = $1 AND r.id = $2`,
      [bookingId, reqRows[0]?.id],
    );
    expect(afterReject[0]?.start_at).toContain("2026-09-28");
    expect(afterReject[0]?.req_status).toBe("rejected");

    const sameBandReq = await queryRows<{ id: string }>(
      db,
      `INSERT INTO public.booking_reschedule_requests (
         booking_id, status, requested_by, proposed_start_at, proposed_end_at, original_start_at, original_end_at
       ) VALUES ($1, 'pending', $2, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz)
       RETURNING id`,
      [
        bookingId,
        IDS.customer,
        "2026-09-29T10:00:00Z",
        "2026-09-29T12:00:00Z",
        BOOKING_START,
        BOOKING_END,
      ],
    );
    const sameBand = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.respond_reschedule($1::uuid, 'accept')`,
      [sameBandReq[0]?.id],
    );
    expect(sameBand.ok).toBe(true);
    const accepted = await queryRows<{ start_at: string; req_status: string }>(
      db,
      `SELECT b.start_at::text AS start_at, r.status AS req_status
       FROM public.bookings b
       JOIN public.booking_reschedule_requests r ON r.booking_id = b.id
       WHERE b.id = $1 AND r.id = $2`,
      [bookingId, sameBandReq[0]?.id],
    );
    expect(accepted[0]?.start_at).toContain("2026-09-29");
    expect(accepted[0]?.req_status).toBe("accepted");

    const unchanged = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.bookings SET notes = 'keep start', start_at = start_at WHERE id = $1`,
      [bookingId],
    );
    expect(unchanged.ok).toBe(true);
    const stillSameBand = await queryRows<{ start_at: string; notes: string }>(
      db,
      `SELECT start_at::text AS start_at, notes FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(stillSameBand[0]?.start_at).toContain("2026-09-29");
    expect(stillSameBand[0]?.notes).toBe("keep start");
  });

  it("blocks babysitting completion without max or capabilities and keeps reference/coverage rules", async () => {
    db = await readyDb();

    const missingBoth = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_completion: { errors: Record<string, string> } }>(
        db!,
        `SELECT public.provider_onboarding_completion($1)`,
        [IDS.provider],
      ),
    );
    expect(missingBoth[0]?.provider_onboarding_completion.errors.experience).toBe(
      "babysitting_details_required",
    );
    expect(missingBoth[0]?.provider_onboarding_completion.errors.references).toBe(
      "reference_required",
    );
    expect(missingBoth[0]?.provider_onboarding_completion.errors.coverage).toBeUndefined();

    await db.exec(`
      UPDATE public.providers SET max_children_per_booking = 2 WHERE id = '${IDS.provider}'
    `);
    const missingCaps = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_completion: { errors: Record<string, string> } }>(
        db!,
        `SELECT public.provider_onboarding_completion($1)`,
        [IDS.provider],
      ),
    );
    expect(missingCaps[0]?.provider_onboarding_completion.errors.experience).toBe(
      "babysitting_details_required",
    );

    await db.exec(`
      UPDATE public.providers SET max_children_per_booking = NULL WHERE id = '${IDS.provider}';
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);
    const missingMax = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_completion: { errors: Record<string, string> } }>(
        db!,
        `SELECT public.provider_onboarding_completion($1)`,
        [IDS.provider],
      ),
    );
    expect(missingMax[0]?.provider_onboarding_completion.errors.experience).toBe(
      "babysitting_details_required",
    );

    await db.exec(`
      UPDATE public.providers SET max_children_per_booking = 2 WHERE id = '${IDS.provider}'
    `);
    const babysittingReady = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_completion: { errors: Record<string, string> } }>(
        db!,
        `SELECT public.provider_onboarding_completion($1)`,
        [IDS.provider],
      ),
    );
    expect(babysittingReady[0]?.provider_onboarding_completion.errors.experience).toBeUndefined();
    expect(babysittingReady[0]?.provider_onboarding_completion.errors.references).toBe(
      "reference_required",
    );

    await db.exec(`
      DELETE FROM public.provider_services
      WHERE provider_id = '${IDS.provider}' AND service_id = '${IDS.babysittingService}';
      DELETE FROM public.zone_providers WHERE provider_id = '${IDS.provider}';
      UPDATE public.providers SET max_children_per_booking = NULL WHERE id = '${IDS.provider}';
      DELETE FROM public.provider_age_group_capabilities WHERE provider_id = '${IDS.provider}';
    `);
    const cleaningOnly = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_onboarding_completion: { errors: Record<string, string> } }>(
        db!,
        `SELECT public.provider_onboarding_completion($1)`,
        [IDS.provider],
      ),
    );
    expect(cleaningOnly[0]?.provider_onboarding_completion.errors.experience).not.toBe(
      "babysitting_details_required",
    );
    expect(cleaningOnly[0]?.provider_onboarding_completion.errors.references).toBe(
      "reference_required",
    );
    expect(cleaningOnly[0]?.provider_onboarding_completion.errors.coverage).toBe("zone_required");
  });
});
