import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applySupabaseDefaultPrivileges,
  createDisposableDb,
  functionExecuteAllowed,
  IDS,
  insertBooking,
  queryRows,
  readMigration,
  seedIdentities,
  tryAsUser,
  asUser,
} from "./babysitting-capabilities-harness";

export const SECURITY_WRITE_GUARDS_MIGRATION = "20261001110000_security_write_guards.sql";

const BOOKING_ID = "00000000-0000-0000-0000-000000000801";
const OTHER_PROVIDER_BOOKING_ID = "00000000-0000-0000-0000-000000000802";
const REVIEW_ID = "00000000-0000-0000-0000-000000000901";
const CASH_PAYMENT_ID = "00000000-0000-0000-0000-000000000a01";
const INSTAPAY_PAYMENT_ID = "00000000-0000-0000-0000-000000000a02";
const PAYMOB_PAYMENT_ID = "00000000-0000-0000-0000-000000000a03";
const PAYMOB_OTHER_PAYMENT_ID = "00000000-0000-0000-0000-000000000a04";

const EXTRA_SCHEMA_SQL = `
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_top_pro boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS vacation_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_en text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS bio_ar text NOT NULL DEFAULT '';
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS years_experience int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  rating smallint NOT NULL,
  comment text,
  provider_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
    CREATE TYPE public.booking_status AS ENUM (
      'pending','confirmed','in_progress','completed','cancelled','no_show'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM (
      'pending','authorized','captured','failed','refunded','partially_refunded','pending_review','rejected'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'otp_purpose') THEN
    CREATE TYPE public.otp_purpose AS ENUM ('LOGIN', 'SIGNUP', 'RESET_PASSWORD');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  customer_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  status public.payment_status NOT NULL DEFAULT 'pending',
  payment_method_code text,
  payment_method_type text,
  provider_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text
);

CREATE TABLE IF NOT EXISTS public.paymob_webhook_events (
  paymob_transaction_id bigint PRIMARY KEY,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('captured', 'rejected', 'pending', 'ignored')),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.claim_password_setup_authorization(
  p_auth_id uuid,
  p_user_id uuid,
  p_phone text,
  p_purpose public.otp_purpose
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose)
  TO service_role, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue94_server_only_definer()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.issue94_server_only_definer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue94_server_only_definer() TO service_role, anon, authenticated;
`;

const GRANTS_AND_TRIGGERS_SQL = `
GRANT SELECT, INSERT, UPDATE ON public.reviews TO authenticated, service_role;
GRANT SELECT, UPDATE ON public.profiles TO authenticated, service_role;
GRANT SELECT, UPDATE ON public.providers TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated, service_role;
GRANT SELECT, INSERT ON public.paymob_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.paymob_apply_transaction_webhook(bigint, uuid, boolean, boolean, bigint, text, jsonb, text)
  TO service_role;
`;

async function readyDb(): Promise<PGlite> {
  const db = await createDisposableDb();
  await applySupabaseDefaultPrivileges(db);
  await db.exec(EXTRA_SCHEMA_SQL);
  await applyBabysittingMigration(db);
  await db.exec(readMigration(SECURITY_WRITE_GUARDS_MIGRATION));
  await db.exec(GRANTS_AND_TRIGGERS_SQL);
  await seedIdentities(db);
  await db.exec(`
    BEGIN;
    SELECT set_config('app.onboarding_status_transition', '1', true);
    UPDATE public.providers
    SET onboarding_status = 'APPROVED',
        is_verified = false,
        is_top_pro = false,
        is_active = true,
        vacation_mode = false,
        bio_en = 'Bio',
        hourly_rate = 100
    WHERE id IN ('${IDS.provider}', '${IDS.otherProvider}');
    COMMIT;

    INSERT INTO public.bookings (
      id, customer_id, provider_id, service_id, address_id, family_member_id,
      start_at, end_at, status, price_subtotal, price_discount, price_total
    ) VALUES
      (
        '${BOOKING_ID}', '${IDS.customer}', '${IDS.provider}', '${IDS.cleaningService}',
        '${IDS.address}', NULL, '2026-09-01T10:00:00Z', '2026-09-01T12:00:00Z',
        'completed', 200, 0, 249
      ),
      (
        '${OTHER_PROVIDER_BOOKING_ID}', '${IDS.customer}', '${IDS.otherProvider}',
        '${IDS.cleaningService}', '${IDS.address}', NULL,
        '2026-09-02T10:00:00Z', '2026-09-02T12:00:00Z',
        'completed', 200, 0, 249
      );

    INSERT INTO public.reviews (id, booking_id, customer_id, provider_id, rating, comment)
    VALUES ('${REVIEW_ID}', '${BOOKING_ID}', '${IDS.customer}', '${IDS.provider}', 1, 'late');

    INSERT INTO public.payments (
      id, booking_id, customer_id, amount, status,
      payment_method_code, payment_method_type, metadata
    ) VALUES
      (
        '${CASH_PAYMENT_ID}', '${BOOKING_ID}', '${IDS.customer}', 249, 'pending',
        'cash_on_delivery', 'cash', '{}'::jsonb
      ),
      (
        '${INSTAPAY_PAYMENT_ID}', '${BOOKING_ID}', '${IDS.customer}', 249, 'pending',
        'instapay', 'manual_transfer', '{}'::jsonb
      ),
      (
        '${PAYMOB_PAYMENT_ID}', '${BOOKING_ID}', '${IDS.customer}', 100, 'pending',
        'paymob', 'online', jsonb_build_object('paymob_order_id', '888')
      ),
      (
        '${PAYMOB_OTHER_PAYMENT_ID}', '${OTHER_PROVIDER_BOOKING_ID}', '${IDS.customer}', 100, 'pending',
        'paymob', 'online', jsonb_build_object('paymob_order_id', '777')
      );
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();

    DROP TRIGGER IF EXISTS trg_validate_payment_capture ON public.payments;
    CREATE TRIGGER trg_validate_payment_capture
      BEFORE INSERT OR UPDATE ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_payment_capture();
  `);
  return db;
}

async function tryAsServiceRole(
  db: PGlite,
  sql: string,
  params?: unknown[],
): Promise<{ ok: boolean; error?: string; rows?: Record<string, unknown>[] }> {
  try {
    await db.exec("BEGIN");
    await db.exec("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE service_role");
    const rows = params ? await queryRows(db, sql, params) : await queryRows(db, sql);
    await db.exec("COMMIT");
    return { ok: true, rows };
  } catch (error) {
    await db.exec("ROLLBACK");
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function expectRejected(
  result: { ok: boolean; error?: string },
  pattern: RegExp,
  label: string,
): void {
  expect(result.ok, `${label} should be rejected`).toBe(false);
  expect(result.error ?? "", label).toMatch(pattern);
}

describe("security write guards (issue #94)", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("S1 rejects a provider changing rating or comment on a review about themselves", async () => {
    db = await readyDb();
    const attack = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.reviews SET rating = 5, comment = 'rewritten' WHERE id = $1 RETURNING rating`,
      [REVIEW_ID],
    );
    expectRejected(attack, /Providers may only update the provider reply|42501/, "S1");

    const rows = await queryRows<{ rating: number; comment: string }>(
      db,
      `SELECT rating, comment FROM public.reviews WHERE id = $1`,
      [REVIEW_ID],
    );
    expect(rows[0]?.rating).toBe(1);
    expect(rows[0]?.comment).toBe("late");
  });

  it("S2 rejects a customer moving their review onto another provider", async () => {
    db = await readyDb();
    const attack = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.reviews SET provider_id = $1 WHERE id = $2 RETURNING provider_id`,
      [IDS.otherProvider, REVIEW_ID],
    );
    expectRejected(attack, /cannot be changed|42501/, "S2");
  });

  it("S3 rejects a suspended customer unsuspending themselves", async () => {
    db = await readyDb();
    await db.exec(`UPDATE public.profiles SET is_suspended = true WHERE id = '${IDS.customer}'`);
    const attack = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.profiles SET is_suspended = false WHERE id = $1 RETURNING is_suspended`,
      [IDS.customer],
    );
    expectRejected(attack, /Suspension status|42501/, "S3");
    const rows = await queryRows<{ is_suspended: boolean }>(
      db,
      `SELECT is_suspended FROM public.profiles WHERE id = $1`,
      [IDS.customer],
    );
    expect(rows[0]?.is_suspended).toBe(true);
  });

  it("S4 rejects an approved provider setting is_verified or is_top_pro", async () => {
    db = await readyDb();
    const verified = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET is_verified = true WHERE id = $1 RETURNING is_verified`,
      [IDS.provider],
    );
    expectRejected(verified, /verification and activation|42501/, "S4 is_verified");

    const topPro = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET is_top_pro = true WHERE id = $1 RETURNING is_top_pro`,
      [IDS.provider],
    );
    expectRejected(topPro, /verification and activation|42501/, "S4 is_top_pro");
  });

  it("S5 rejects a deactivated provider setting is_active true", async () => {
    db = await readyDb();
    await db.exec(`UPDATE public.providers SET is_active = false WHERE id = '${IDS.provider}'`);
    const attack = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.providers SET is_active = true WHERE id = $1 RETURNING is_active`,
      [IDS.provider],
    );
    expectRejected(attack, /verification and activation|42501/, "S5");
  });

  it("S6 rejects hourly_rate that bypasses service min/max when price_override is null", async () => {
    db = await readyDb();
    await db.exec(`
      UPDATE public.services
      SET provider_pricing_allowed = true, minimum_price = 50, maximum_price = 150
      WHERE id = '${IDS.cleaningService}';
      UPDATE public.provider_services
      SET price_override = NULL
      WHERE provider_id = '${IDS.provider}' AND service_id = '${IDS.cleaningService}';
      UPDATE public.providers SET hourly_rate = 999 WHERE id = '${IDS.provider}';
    `);

    const attack = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(attack.ok, "S6 should be rejected").toBe(false);
    expect(attack.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("S6 keeps hourly_rate bookings when provider_pricing_allowed is false and applies min/max", async () => {
    db = await readyDb();
    await db.exec(`
      UPDATE public.services
      SET provider_pricing_allowed = false, minimum_price = 50, maximum_price = 150
      WHERE id = '${IDS.cleaningService}';
      UPDATE public.provider_services
      SET price_override = NULL
      WHERE provider_id = '${IDS.provider}' AND service_id = '${IDS.cleaningService}';
      UPDATE public.providers SET hourly_rate = 100 WHERE id = '${IDS.provider}';
    `);

    const inside = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(inside.ok, "S6 hourly_rate inside min/max with pricing disallowed").toBe(true);

    await db.exec(`UPDATE public.providers SET hourly_rate = 999 WHERE id = '${IDS.provider}'`);
    const outside = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(outside.ok, "S6 hourly_rate outside min/max with pricing disallowed").toBe(false);
    expect(outside.error ?? "").toMatch(/BOOKING_PROVIDER_INELIGIBLE/);
  });

  it("S7 rejects provider capture of InstaPay and Paymob-without-webhook", async () => {
    db = await readyDb();
    const instapay = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status`,
      [INSTAPAY_PAYMENT_ID],
    );
    expectRejected(instapay, /admin review|42501/, "S7 InstaPay");

    const paymob = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status`,
      [PAYMOB_PAYMENT_ID],
    );
    expectRejected(paymob, /Paymob online payments|42501/, "S7 Paymob");
  });

  it("S8 rejects a Paymob webhook rebound onto a payment with a different stored order id", async () => {
    db = await readyDb();
    await expect(
      db.query(
        `SELECT public.paymob_apply_transaction_webhook(
           111::bigint, $1::uuid, true, false, 10000::bigint, '111', '{}'::jsonb, '888'
         )`,
        [PAYMOB_OTHER_PAYMENT_ID],
      ),
    ).rejects.toThrow(/Paymob order id mismatch|42501/);

    const rows = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.payments WHERE id = $1`,
      [PAYMOB_OTHER_PAYMENT_ID],
    );
    expect(rows[0]?.status).toBe("pending");
  });

  it("S9 revokes EXECUTE on claim_password_setup_authorization from anon and authenticated", async () => {
    db = await readyDb();
    expect(
      await functionExecuteAllowed(
        db,
        "anon",
        "public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose)",
      ),
    ).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "authenticated",
        "public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose)",
      ),
    ).toBe(false);
    expect(
      await functionExecuteAllowed(
        db,
        "service_role",
        "public.claim_password_setup_authorization(uuid, uuid, text, public.otp_purpose)",
      ),
    ).toBe(true);
    expect(await functionExecuteAllowed(db, "anon", "public.issue94_server_only_definer()")).toBe(
      false,
    );
    expect(
      await functionExecuteAllowed(db, "authenticated", "public.issue94_server_only_definer()"),
    ).toBe(false);
  });

  it("allows provider reply, customer rating/comment, admin suspend/verify, vacation toggle, cash capture, and matching Paymob webhook", async () => {
    db = await readyDb();
    if (!db) throw new Error("PGlite database was not created");
    const conn = db;

    const reply = await tryAsUser(
      conn,
      IDS.providerUser,
      `UPDATE public.reviews SET provider_reply = 'thank you' WHERE id = $1 RETURNING provider_reply`,
      [REVIEW_ID],
    );
    expect(reply.ok, "provider reply").toBe(true);
    expect(reply.rows?.[0]?.provider_reply).toBe("thank you");

    const edit = await tryAsUser(
      conn,
      IDS.customer,
      `UPDATE public.reviews SET rating = 4, comment = 'better' WHERE id = $1 RETURNING rating, comment`,
      [REVIEW_ID],
    );
    expect(edit.ok, "customer rating/comment").toBe(true);
    expect(edit.rows?.[0]?.rating).toBe(4);
    expect(edit.rows?.[0]?.comment).toBe("better");

    const unsuspend = await tryAsUser(
      conn,
      IDS.adminUser,
      `UPDATE public.profiles SET is_suspended = true WHERE id = $1 RETURNING is_suspended`,
      [IDS.customer],
    );
    expect(unsuspend.ok, "admin suspend").toBe(true);

    const adminUnsuspend = await tryAsUser(
      conn,
      IDS.adminUser,
      `UPDATE public.profiles SET is_suspended = false WHERE id = $1 RETURNING is_suspended`,
      [IDS.customer],
    );
    expect(adminUnsuspend.ok, "admin unsuspend").toBe(true);

    const verify = await tryAsUser(
      conn,
      IDS.adminUser,
      `UPDATE public.providers SET is_verified = true, is_top_pro = true WHERE id = $1 RETURNING is_verified, is_top_pro`,
      [IDS.provider],
    );
    expect(verify.ok, "admin verify").toBe(true);

    const deactivate = await tryAsUser(
      conn,
      IDS.adminUser,
      `UPDATE public.providers SET is_active = false WHERE id = $1 RETURNING is_active`,
      [IDS.provider],
    );
    expect(deactivate.ok, "admin deactivate").toBe(true);

    await conn.exec(`UPDATE public.providers SET is_active = true WHERE id = '${IDS.provider}'`);

    const vacation = await tryAsUser(
      conn,
      IDS.providerUser,
      `UPDATE public.providers SET vacation_mode = true WHERE id = $1 RETURNING vacation_mode`,
      [IDS.provider],
    );
    expect(vacation.ok, "provider vacation toggle").toBe(true);

    const gucVerify = await asUser(conn, IDS.providerUser, async () => {
      await conn.exec("SELECT set_config('app.onboarding_status_transition', '1', true)");
      return queryRows<{ is_verified: boolean }>(
        conn,
        `UPDATE public.providers SET is_verified = false WHERE id = $1 RETURNING is_verified`,
        [IDS.provider],
      );
    });
    expect(gucVerify[0]?.is_verified).toBe(false);

    const cash = await tryAsUser(
      conn,
      IDS.providerUser,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status`,
      [CASH_PAYMENT_ID],
    );
    expect(cash.ok, "cash capture by provider").toBe(true);

    const adminInstapay = await tryAsUser(
      conn,
      IDS.adminUser,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status`,
      [INSTAPAY_PAYMENT_ID],
    );
    expect(adminInstapay.ok, "admin InstaPay capture").toBe(true);

    const webhook = await conn.query<{ paymob_apply_transaction_webhook: unknown }>(
      `SELECT public.paymob_apply_transaction_webhook(
         222::bigint, $1::uuid, true, false, 10000::bigint, '222', '{}'::jsonb, '888'
       ) AS paymob_apply_transaction_webhook`,
      [PAYMOB_PAYMENT_ID],
    );
    const payload = webhook.rows[0]?.paymob_apply_transaction_webhook as {
      ok?: boolean;
      status?: string;
    };
    expect(payload?.ok).toBe(true);
    expect(payload?.status).toBe("captured");

    await conn.exec(`
      UPDATE public.services
      SET provider_pricing_allowed = true, minimum_price = 50, maximum_price = 150
      WHERE id = '${IDS.cleaningService}';
      UPDATE public.provider_services
      SET price_override = NULL
      WHERE provider_id = '${IDS.provider}' AND service_id = '${IDS.cleaningService}';
      UPDATE public.providers SET hourly_rate = 100 WHERE id = '${IDS.provider}';
    `);
    const inRange = await insertBooking(conn, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(inRange.ok, "effective hourly_rate within min/max").toBe(true);

    const serviceRoleUnsuspend = await tryAsServiceRole(
      conn,
      `UPDATE public.profiles SET is_suspended = true WHERE id = $1 RETURNING is_suspended`,
      [IDS.otherCustomer],
    );
    expect(serviceRoleUnsuspend.ok, "service_role suspend").toBe(true);
  });
});
