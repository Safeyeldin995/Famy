import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applyDeclarationMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BOOKING_END,
  BOOKING_START,
  createDisposableDb,
  IDS,
  queryRows,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";

const DECLARATION_FIXTURE_SQL = `
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

const CREATE_BOOKING_SQL = `
CREATE OR REPLACE FUNCTION public.create_booking(
  p_provider_id uuid,
  p_service_id uuid,
  p_address_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_idempotency_key uuid,
  p_family_member_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_promo_code_id uuid DEFAULT NULL,
  p_requirement_selections jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_fingerprint text;
  v_existing RECORD;
  v_booking_id uuid;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF public.is_not_suspended(v_uid) IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOKING_UNAUTHORIZED: Account is suspended.' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Idempotency key is required.' USING ERRCODE = '23514';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'BOOKING_INVALID_BOOKING_REQUEST: Invalid booking time range.' USING ERRCODE = '23514';
  END IF;

  v_fingerprint := public.booking_request_fingerprint(
    p_provider_id, p_service_id, p_address_id, p_start_at, p_end_at,
    p_family_member_id, p_notes, p_promo_code_id, coalesce(p_requirement_selections, '[]'::jsonb)
  );

  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_idempotency_key::text));

  SELECT id, request_fingerprint INTO v_existing
  FROM public.bookings
  WHERE customer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'BOOKING_DUPLICATE_REQUEST_CONFLICT: Idempotency key reused with different booking details.' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('booking_id', v_existing.id, 'created', false, 'idempotent_replay', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.marketplace_eligibility_internal(p_provider_id, p_service_id, p_address_id) e
    WHERE e.is_eligible
  ) THEN
    RAISE EXCEPTION 'BOOKING_PROVIDER_INELIGIBLE: Provider is not eligible for this service and address.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.create_booking_in_progress', 'on', true);

  INSERT INTO public.bookings (
    customer_id, provider_id, service_id, address_id,
    start_at, end_at, status, notes, family_member_id,
    requirement_selections, promo_code_id,
    price_subtotal, price_discount, price_total,
    price_platform_fee, price_vat, price_extras_total, price_travel_fee,
    idempotency_key, request_fingerprint, currency
  ) VALUES (
    v_uid, p_provider_id, p_service_id, p_address_id,
    p_start_at, p_end_at, 'pending', NULLIF(btrim(p_notes), ''), p_family_member_id,
    coalesce(p_requirement_selections, '[]'::jsonb), p_promo_code_id,
    0, 0, 0, 0, 0, 0, 0,
    p_idempotency_key, v_fingerprint, 'EGP'
  ) RETURNING id INTO v_booking_id;
  v_created := true;

  RETURN jsonb_build_object('booking_id', v_booking_id, 'created', v_created, 'idempotent_replay', false);
END;
$$;
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,text,uuid,jsonb) TO authenticated;
`;

const RESPOND_RESCHEDULE_SQL = `
CREATE OR REPLACE FUNCTION public.respond_reschedule(
  p_request_id uuid, p_action text, p_reason text DEFAULT NULL,
  p_counter_start timestamptz DEFAULT NULL, p_counter_end timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req RECORD;
  v_booking RECORD;
  v_is_provider boolean;
  v_expected_responder_is_provider boolean;
BEGIN
  IF p_action NOT IN ('accept', 'reject', 'counter') THEN
    RAISE EXCEPTION 'Invalid action.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_req FROM public.booking_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This reschedule request is no longer open.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_req.booking_id;
  v_is_provider := EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_booking.provider_id AND p.profile_id = auth.uid());
  v_expected_responder_is_provider := (v_req.requested_by = v_booking.customer_id);
  IF v_expected_responder_is_provider AND NOT v_is_provider THEN
    RAISE EXCEPTION 'Only the provider can respond to this request.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_expected_responder_is_provider AND v_booking.customer_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the customer can respond to this request.' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'accept' THEN
    PERFORM public.check_booking_slot(v_booking.provider_id, v_req.proposed_start_at, v_req.proposed_end_at, v_booking.id);
    PERFORM set_config('app.reschedule_in_progress', 'on', true);
    UPDATE public.bookings SET start_at = v_req.proposed_start_at, end_at = v_req.proposed_end_at WHERE id = v_booking.id;
    UPDATE public.booking_reschedule_requests
      SET status = 'accepted', responded_by = auth.uid(), response_reason = p_reason, responded_at = now()
      WHERE id = p_request_id;
  END IF;
  RETURN p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_reschedule(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_reschedule(uuid, text, text, timestamptz, timestamptz) TO authenticated;
`;

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

    const unchanged = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.bookings SET notes = 'keep start' WHERE id = $1`,
      [bookingId],
    );
    expect(unchanged.ok).toBe(true);
  });
});
