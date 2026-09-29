import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applyDeclarationMigration,
  applyMarketplaceBookabilityMigration,
  applySupabaseDefaultPrivileges,
  asUser,
  BOOKING_END,
  BOOKING_START,
  CREATE_BOOKING_MIGRATION,
  createDisposableDb,
  extractPublicFunctionSql,
  IDS,
  MARKETPLACE_BOOKABILITY_MIGRATION,
  queryRows,
  readMigration,
  REQUEST_UPDATED_DETAILS_MIGRATION,
  RESPOND_RESCHEDULE_MIGRATION,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";

/**
 * Schema extras so the tracked marketplace_eligibility_internal body can run on
 * PGlite. Not a replacement for that function. Eligibility is loaded from Phase D.
 */
const ELIGIBILITY_SCHEMA_SQL = `
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS vacation_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_en text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_ar text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS years_experience int NOT NULL DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name_ar text;
ALTER TABLE public.service_requirements ADD COLUMN IF NOT EXISTS required_for_provider_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_requirements ADD COLUMN IF NOT EXISTS evidence_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS request_fingerprint text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS currency text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_customer_idempotency_unique
  ON public.bookings (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.availability_rules (
  provider_id uuid NOT NULL,
  weekday smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL
);
CREATE TABLE IF NOT EXISTS public.provider_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  status text,
  severity text
);
CREATE TABLE IF NOT EXISTS public.provider_requirement_fulfillments (
  provider_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  status text,
  evidence_storage_path text
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
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(btrim(p_phone), ''); $$;
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
`;

const CREATE_BOOKING_SQL = extractPublicFunctionSql(CREATE_BOOKING_MIGRATION, "create_booking");
const RESPOND_RESCHEDULE_SQL = extractPublicFunctionSql(
  RESPOND_RESCHEDULE_MIGRATION,
  "respond_reschedule",
);

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(ELIGIBILITY_SCHEMA_SQL);
  await applyBabysittingMigration(db);
  await applyDeclarationMigration(db);
  await applyMarketplaceBookabilityMigration(db);
  await db.exec(CREATE_BOOKING_SQL);
  await db.exec(RESPOND_RESCHEDULE_SQL);
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
    GRANT INSERT, UPDATE ON public.booking_reschedule_requests TO authenticated;
  `);
  await seedIdentities(db);
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
    BEGIN;
    SELECT set_config('app.onboarding_status_transition', '1', true);
    UPDATE public.providers
    SET onboarding_status = 'APPROVED',
        is_active = true,
        is_verified = true,
        vacation_mode = false,
        deleted_at = NULL,
        bio_en = 'Bio'
    WHERE id = '${IDS.provider}';
    COMMIT;
    INSERT INTO public.availability_rules (provider_id, weekday, start_time, end_time)
    VALUES ('${IDS.provider}', 0, '08:00', '20:00');
    UPDATE public.family_members
    SET date_of_birth = DATE '2023-10-28'
    WHERE id = '${IDS.childMember}';
  `);
  return db;
}

async function eligibility(
  db: PGlite,
  serviceId: string,
): Promise<{ is_eligible: boolean; failure_reasons: string[] } | undefined> {
  const rows = await queryRows<{ is_eligible: boolean; failure_reasons: string[] }>(
    db,
    `SELECT is_eligible, failure_reasons
     FROM public.marketplace_eligibility_internal($1, $2, NULL)`,
    [IDS.provider, serviceId],
  );
  return rows[0];
}

describe("babysitting marketplace bookability phase D", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not rewrite Phase A/B/C and only adds babysitting bookability to eligibility", () => {
    const sql = readMigration(MARKETPLACE_BOOKABILITY_MIGRATION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.marketplace_eligibility_internal(");
    expect(sql).toContain("babysitting_bookable");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.marketplace_eligibility_internal(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public.marketplace_eligibility_internal/);
    expect(sql).not.toMatch(/PERFORM public.assert_babysitting_booking_eligible/);
    expect(readMigration("20260912090000_babysitting_capabilities.sql")).not.toContain(
      "babysitting_bookable",
    );
    expect(readMigration("20260928081021_babysitting_declaration_save.sql")).not.toContain(
      "babysitting_bookable",
    );
    expect(readMigration(REQUEST_UPDATED_DETAILS_MIGRATION)).not.toContain("babysitting_bookable");
  });

  it("hides undeclared babysitting, keeps cleaning, then shows declared babysitting", async () => {
    db = await readyDb();

    const hidden = await eligibility(db, IDS.babysittingService);
    expect(hidden?.is_eligible).toBe(false);
    expect(hidden?.failure_reasons.join(" ")).toMatch(/age-group capabilities are not declared/i);

    const cleaning = await eligibility(db, IDS.cleaningService);
    expect(cleaning?.is_eligible).toBe(true);

    const cleaningCreate = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), NULL)`,
      [IDS.provider, IDS.cleaningService, IDS.address, BOOKING_START, BOOKING_END],
    );
    expect(cleaningCreate.ok).toBe(true);

    const undeclaredBook = await tryAsUser(
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
    expect(undeclaredBook.ok).toBe(false);
    expect(undeclaredBook.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE|not eligible/i);

    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      SELECT set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = 2 WHERE id = '${IDS.provider}';
      COMMIT;
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);

    const shown = await eligibility(db, IDS.babysittingService);
    expect(shown?.is_eligible).toBe(true);
    expect(await eligibility(db, IDS.cleaningService)).toMatchObject({ is_eligible: true });
  });

  it("keeps owned-child and cross-band reschedule asserts after a declared provider is listed", async () => {
    db = await readyDb();
    await db.exec(`
      BEGIN;
      SELECT set_config('app.onboarding_status_transition', '1', true);
      SELECT set_config('app.max_children_declaration', '1', true);
      UPDATE public.providers SET max_children_per_booking = 2 WHERE id = '${IDS.provider}';
      COMMIT;
      INSERT INTO public.provider_age_group_capabilities (provider_id, age_group_code)
      VALUES ('${IDS.provider}', 'toddler');
    `);
    expect((await eligibility(db, IDS.babysittingService))?.is_eligible).toBe(true);

    const myself = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking($1,$2,$3,$4::timestamptz,$5::timestamptz, gen_random_uuid(), NULL)`,
      [IDS.provider, IDS.babysittingService, IDS.address, BOOKING_START, BOOKING_END],
    );
    expect(myself.ok).toBe(false);
    expect(myself.error ?? "").toMatch(/BOOKING_INVALID_BOOKING_REQUEST|owned child/i);

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
  });
});
