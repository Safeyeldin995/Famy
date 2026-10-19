/**
 * PGlite (not native PG17 / remote). Tracked functions loaded unchanged:
 * create_booking, apply_provider_onboarding_status, provider_submit_onboarding,
 * provider_required_documents_approved, assert/log onboarding internals, and the
 * new admin_provider_onboarding_action body. Helper stubs only: phase1 slug,
 * phone normalize, is_not_suspended=true, fingerprint concat_ws, marketplace
 * eligibility = onboarding_status APPROVED (merged gate, not the full matrix),
 * check_booking_slot no-op from the shared harness.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  APPLY_ONBOARDING_STATUS_MIGRATION,
  applyBabysittingMigration,
  applyDeclarationMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BOOKING_END,
  BOOKING_START,
  CREATE_BOOKING_MIGRATION,
  createDisposableDb,
  extractPublicFunctionBlock,
  extractPublicFunctionSql,
  IDS,
  ONBOARDING_SUBMIT_MIGRATION,
  queryRows,
  readMigration,
  REQUEST_UPDATED_DETAILS_MIGRATION,
  REQUIRED_DOCUMENTS_MIGRATION,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";

const REVIEW_FIXTURE_SQL = `
-- Limited unrelated-helper stubs for PGlite. Tracked functions loaded below.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_en text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_ar text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS years_experience int NOT NULL DEFAULT 0;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_public text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS review_reason_code text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS last_review_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
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

CREATE TABLE IF NOT EXISTS public.provider_admin_internal_notes (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  review_notes_internal text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_phase1_category_slug(p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_slug IN ('home-cleaning', 'babysitting');
$$;

CREATE OR REPLACE FUNCTION public.normalize_reference_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(p_phone), '');
$$;

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

-- Limited stub of the merged APPROVED marketplace gate, not the full eligibility matrix.
CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(
  p_provider_id uuid, p_service_id uuid DEFAULT NULL, p_address_id uuid DEFAULT NULL
)
RETURNS TABLE (is_eligible boolean)
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = p_provider_id AND p.onboarding_status = 'APPROVED'
  );
$$;
`;

const CREATE_BOOKING_SQL = extractPublicFunctionSql(CREATE_BOOKING_MIGRATION, "create_booking");
const ASSERT_SQL = extractPublicFunctionBlock(
  ONBOARDING_SUBMIT_MIGRATION,
  "assert_onboarding_internal_call",
);
const LOG_SQL = extractPublicFunctionBlock(
  ONBOARDING_SUBMIT_MIGRATION,
  "log_provider_onboarding_event",
);
const APPLY_SQL = extractPublicFunctionBlock(
  APPLY_ONBOARDING_STATUS_MIGRATION,
  "apply_provider_onboarding_status",
);
const SUBMIT_SQL = extractPublicFunctionBlock(
  ONBOARDING_SUBMIT_MIGRATION,
  "provider_submit_onboarding",
);
const DOCS_SQL = extractPublicFunctionBlock(
  REQUIRED_DOCUMENTS_MIGRATION,
  "provider_required_documents_approved",
);
const ACTION_SQL = readMigration(REQUEST_UPDATED_DETAILS_MIGRATION);

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(REVIEW_FIXTURE_SQL);
  await applyBabysittingMigration(db);
  await applyDeclarationMigration(db);
  await db.exec(CREATE_BOOKING_SQL);
  await db.exec(ASSERT_SQL);
  await db.exec(LOG_SQL);
  await db.exec(APPLY_SQL);
  await db.exec(SUBMIT_SQL);
  await db.exec(DOCS_SQL);
  await db.exec(ACTION_SQL);
  await db.exec(`
    GRANT UPDATE ON public.providers TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.provider_onboarding_details TO authenticated;
    GRANT INSERT, UPDATE, DELETE ON public.provider_age_group_capabilities TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
    GRANT INSERT ON public.provider_references TO authenticated;
    GRANT INSERT ON public.provider_documents TO authenticated;
    GRANT SELECT ON public.provider_onboarding_events TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_save_onboarding_section(text, jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_onboarding_completion(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.provider_submit_onboarding() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.admin_provider_onboarding_action(uuid, text, text, text, text) TO authenticated;
    REVOKE UPDATE (max_children_per_booking) ON public.providers FROM PUBLIC, anon, authenticated;
  `);
  await seedIdentities(db);
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
  `);
  return db;
}

async function seedCompletableProvider(db: PGlite): Promise<void> {
  await db.exec(`
    UPDATE public.profiles
    SET full_name = 'Provider', phone = '+201000000011', avatar_url = 'avatars/p.jpg'
    WHERE id = '${IDS.providerUser}';
    INSERT INTO public.provider_onboarding_details (
      provider_id, date_of_birth, governorate, area, full_address, accuracy_confirmed_at
    ) VALUES (
      '${IDS.provider}', DATE '1990-01-01', 'Cairo', 'Maadi', 'Road 9', now()
    ) ON CONFLICT (provider_id) DO UPDATE
      SET date_of_birth = EXCLUDED.date_of_birth,
          governorate = EXCLUDED.governorate,
          area = EXCLUDED.area,
          full_address = EXCLUDED.full_address,
          accuracy_confirmed_at = EXCLUDED.accuracy_confirmed_at;
    INSERT INTO public.provider_references (provider_id, full_name, relationship, phone, sort_order)
    VALUES ('${IDS.provider}', 'Nadia', 'former_client', '+201011122233', 1);
    INSERT INTO public.provider_documents (provider_id, type, status)
    VALUES
      ('${IDS.provider}', 'id_card_front', 'approved'),
      ('${IDS.provider}', 'id_card_back', 'approved');
    UPDATE public.providers
    SET bio_en = 'Bio', years_experience = 2
    WHERE id = '${IDS.provider}';
  `);
}

describe("approved request updated details", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("loads the additive action from the new migration without rewriting Phase A/B", () => {
    expect(ACTION_SQL).toContain("request_updated_details");
    expect(ACTION_SQL).toContain("Administrators cannot request updated details for their own");
    expect(ACTION_SQL).toContain(
      "IF v_provider.onboarding_status NOT IN ('SUBMITTED', 'UNDER_REVIEW')",
    );
    expect(readMigration("20260912090000_babysitting_capabilities.sql")).not.toContain(
      "request_updated_details",
    );
    expect(readMigration("20260928081021_babysitting_declaration_save.sql")).not.toContain(
      "request_updated_details",
    );
  });

  it("denies unauthorized and self-action, moves APPROVED to NEEDS_CHANGES, and preserves bookings", async () => {
    db = await readyDb();
    await seedCompletableProvider(db);
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers
      SET max_children_per_booking = 2, onboarding_status = 'APPROVED', is_verified = true, bio_en = 'Bio'
      WHERE id = '${IDS.provider}';
      COMMIT;
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);

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

    const asCustomer = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', 'Need age-group details')`,
      [IDS.provider],
    );
    expect(asCustomer.ok).toBe(false);

    const asProvider = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', 'Need age-group details')`,
      [IDS.provider],
    );
    expect(asProvider.ok).toBe(false);

    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers SET onboarding_status = 'APPROVED', is_verified = true
      WHERE id = '${IDS.providerAdminProvider}';
      COMMIT;
    `);
    const selfAction = await tryAsUser(
      db,
      IDS.providerAdminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', 'Need age-group details')`,
      [IDS.providerAdminProvider],
    );
    expect(selfAction.ok).toBe(false);
    expect(selfAction.error ?? "").toMatch(/own provider/i);

    const missingReason = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', '')`,
      [IDS.provider],
    );
    expect(missingReason.ok).toBe(false);

    const legacyRequestChanges = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_changes', 'missing_info', 'Please update')`,
      [IDS.provider],
    );
    expect(legacyRequestChanges.ok).toBe(false);

    const requested = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', 'Need babysitting age-group declaration')`,
      [IDS.provider],
    );
    expect(requested.ok).toBe(true);

    const after = await queryRows<{
      onboarding_status: string;
      review_reason_code: string;
      review_reason_public: string;
      max_children_per_booking: number | null;
    }>(
      db,
      `SELECT onboarding_status, review_reason_code, review_reason_public, max_children_per_booking
       FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(after[0]?.onboarding_status).toBe("NEEDS_CHANGES");
    expect(after[0]?.review_reason_code).toBe("updated_details_required");
    expect(after[0]?.review_reason_public).toBe("Need babysitting age-group declaration");
    expect(after[0]?.max_children_per_booking).toBe(2);

    const events = await queryRows<{ action: string; previous_status: string; new_status: string }>(
      db,
      `SELECT action, previous_status, new_status FROM public.provider_onboarding_events
       WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [IDS.provider],
    );
    expect(events[0]).toMatchObject({
      action: "request_updated_details",
      previous_status: "APPROVED",
      new_status: "NEEDS_CHANGES",
    });

    const existing = await queryRows<{ id: string; start_at: string; status: string }>(
      db,
      `SELECT id, start_at::text AS start_at, status FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(existing[0]?.id).toBe(bookingId);
    expect(existing[0]?.status).toBe("pending");
    expect(existing[0]?.start_at).toContain("2026-09-28");

    const notes = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.bookings SET notes = 'still open' WHERE id = $1`,
      [bookingId],
    );
    expect(notes.ok).toBe(true);

    const newBooking = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), $6)`,
      [
        IDS.provider,
        IDS.babysittingService,
        IDS.address,
        BOOKING_START,
        BOOKING_END,
        IDS.childMember,
      ],
    );
    expect(newBooking.ok).toBe(false);
    expect(newBooking.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("allows declaration then rejects incomplete reapproval and accepts a complete resubmit", async () => {
    db = await readyDb();
    await seedCompletableProvider(db);
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      UPDATE public.providers
      SET max_children_per_booking = 2, onboarding_status = 'APPROVED', is_verified = true, bio_en = 'Bio'
      WHERE id = '${IDS.provider}';
      COMMIT;
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);

    const requested = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'request_updated_details', 'updated_details_required', 'Declare catalogue capabilities')`,
      [IDS.provider],
    );
    expect(requested.ok).toBe(true);

    await db.exec(
      `UPDATE public.providers SET max_children_per_booking = NULL WHERE id = '${IDS.provider}'`,
    );
    await db.exec(
      `DELETE FROM public.provider_age_group_capabilities WHERE provider_id = '${IDS.provider}'`,
    );

    const incompleteSubmit = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_submit_onboarding: { ok: boolean; errors?: Record<string, string> } }>(
        db!,
        `SELECT public.provider_submit_onboarding()`,
      ),
    );
    expect(incompleteSubmit[0]?.provider_submit_onboarding.ok).toBe(false);
    expect(incompleteSubmit[0]?.provider_submit_onboarding.errors?.experience).toBe(
      "babysitting_details_required",
    );

    const incompleteApprove = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'approve')`,
      [IDS.provider],
    );
    expect(incompleteApprove.ok).toBe(false);

    const saved = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.provider_save_onboarding_section('experience', $1::jsonb)`,
      [
        JSON.stringify({
          bio_en: "Bio",
          years_experience: 2,
          age_group_capabilities: [{ code: "toddler", years_experience: 3 }],
          max_children_per_booking: 2,
        }),
      ],
    );
    expect(saved.ok).toBe(true);

    const submitted = await asUser(db, IDS.providerUser, async () =>
      queryRows<{ provider_submit_onboarding: { ok: boolean; status?: string } }>(
        db!,
        `SELECT public.provider_submit_onboarding()`,
      ),
    );
    expect(submitted[0]?.provider_submit_onboarding.ok).toBe(true);
    expect(submitted[0]?.provider_submit_onboarding.status).toBe("SUBMITTED");

    const approved = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_provider_onboarding_action($1, 'approve')`,
      [IDS.provider],
    );
    expect(approved.ok).toBe(true);

    const status = await queryRows<{ onboarding_status: string }>(
      db,
      `SELECT onboarding_status FROM public.providers WHERE id = $1`,
      [IDS.provider],
    );
    expect(status[0]?.onboarding_status).toBe("APPROVED");

    const booking = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), $6)`,
      [
        IDS.provider,
        IDS.babysittingService,
        IDS.address,
        BOOKING_START,
        BOOKING_END,
        IDS.childMember,
      ],
    );
    expect(booking.ok).toBe(true);
  });
});
