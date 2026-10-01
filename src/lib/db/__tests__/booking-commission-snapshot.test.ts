import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyBabysittingMigration,
  applySql,
  applySupabaseDefaultPrivileges,
  createDisposableDb,
  IDS,
  insertBooking,
  queryRows,
  readMigration,
  seedIdentities,
  tryAsUser,
} from "./babysitting-capabilities-harness";

const COMMISSION_MIGRATION = "20261001120000_booking_commission_snapshot.sql";
/** Fixture rate for tests only — not a product default or policy. */
const FIXTURE_COMMISSION_PERCENT = 12.5;
const EXTRA_FEE = 50;
const TRAVEL_FEE = 40;

async function attachInsertTrigger(db: PGlite): Promise<void> {
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_service ON public.bookings;
    CREATE TRIGGER trg_validate_booking_service
      BEFORE INSERT ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_service();
  `);
}

async function attachTransitionTrigger(db: PGlite): Promise<void> {
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_validate_booking_transition ON public.bookings;
    CREATE TRIGGER trg_validate_booking_transition
      BEFORE UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.tg_validate_booking_transition();
  `);
}

async function prepareTransitionTypes(db: PGlite): Promise<void> {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status') THEN
        CREATE TYPE public.booking_status AS ENUM (
          'pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed',
          'in_progress', 'completion_requested', 'completed', 'cancelled', 'no_show', 'disputed'
        );
      END IF;
    END
    $$;

    ALTER TABLE public.bookings
      ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
      ADD COLUMN IF NOT EXISTS status_changed_by uuid,
      ADD COLUMN IF NOT EXISTS completion_requested_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS arrival_confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS arrival_confirmed_by uuid,
      ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
      ADD COLUMN IF NOT EXISTS cancelled_by uuid,
      ADD COLUMN IF NOT EXISTS cancellation_reason text,
      ADD COLUMN IF NOT EXISTS no_show_party text,
      ADD COLUMN IF NOT EXISTS no_show_reported_by uuid,
      ADD COLUMN IF NOT EXISTS no_show_reason text,
      ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
      ADD COLUMN IF NOT EXISTS dispute_reason text,
      ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamptz,
      ADD COLUMN IF NOT EXISTS dispute_resolved_by uuid;
  `);
}

async function applyCommissionMigration(db: PGlite): Promise<void> {
  await applySql(db, readMigration(COMMISSION_MIGRATION));
}

async function setCommissionPercent(db: PGlite, percent: number | null): Promise<void> {
  if (percent == null) {
    await db.exec(`
      UPDATE public.settings
      SET value = '{"platform_fee": 25, "vat_percent": 14}'::jsonb
      WHERE key = 'billing'
    `);
    return;
  }
  await db.query(
    `UPDATE public.settings
     SET value = jsonb_build_object('platform_fee', 25, 'vat_percent', 14, 'commission_percent', $1::numeric)
     WHERE key = 'billing'`,
    [percent],
  );
}

async function seedPricingExtras(db: PGlite): Promise<void> {
  await db.exec(`
    UPDATE public.zones SET travel_fee = ${TRAVEL_FEE} WHERE id = '${IDS.zone}';
    INSERT INTO public.service_requirements (
      id, service_id, is_active, required_during_booking, fulfillment_mode, provider_extra_fee, name_en
    ) VALUES (
      '00000000-0000-0000-0000-000000000711',
      '${IDS.cleaningService}', true, true, 'provider', ${EXTRA_FEE}, 'Supplies'
    )
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function insertWithClientSnapshot(
  db: PGlite,
  values: { percent: number; amount: number; net: number; start: string },
): Promise<string> {
  await db.exec("BEGIN");
  try {
    await db.exec("SELECT set_config('app.create_booking_in_progress', 'on', true)");
    const rows = await queryRows<{ id: string }>(
      db,
      `
        INSERT INTO public.bookings (
          customer_id, provider_id, service_id, address_id,
          start_at, end_at, status, price_subtotal, price_discount, price_total,
          price_commission_percent, price_commission_amount, price_provider_net
        ) VALUES (
          $1, $2, $3, $4,
          $5::timestamptz, $5::timestamptz + interval '2 hours', 'pending', 0, 0, 0,
          $6, $7, $8
        )
        RETURNING id
      `,
      [
        IDS.customer,
        IDS.provider,
        IDS.cleaningService,
        IDS.address,
        values.start,
        values.percent,
        values.amount,
        values.net,
      ],
    );
    await db.exec("COMMIT");
    return rows[0].id;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function snapshotOf(db: PGlite, id: string) {
  const rows = await queryRows<{
    price_subtotal: number;
    price_extras_total: number;
    price_travel_fee: number;
    price_commission_percent: number | null;
    price_commission_amount: number | null;
    price_provider_net: number | null;
  }>(
    db,
    `SELECT price_subtotal, price_extras_total, price_travel_fee,
            price_commission_percent, price_commission_amount, price_provider_net
     FROM public.bookings WHERE id = $1`,
    [id],
  );
  return rows[0];
}

describe("booking commission snapshot", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not backfill, hard-code a rate, or mutate existing rows", () => {
    const sql = readMigration(COMMISSION_MIGRATION);
    expect(sql).not.toMatch(/UPDATE\s+public\.bookings/i);
    expect(sql).not.toMatch(/12\.5/);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS price_commission_percent");
    expect(sql).toContain("v_commission_base := v_expected_subtotal + v_extras_total");
    expect(sql).toContain("ROUND(v_commission_base * v_commission_percent / 100.0, 2)");
    expect(sql).toContain(
      "NEW.price_provider_net := v_commission_base + v_travel_fee - NEW.price_commission_amount",
    );
  });

  it("leaves existing bookings NULL and snapshots new bookings from the admin rate", async () => {
    db = await createDisposableDb();
    await applySupabaseDefaultPrivileges(db);
    await applyBabysittingMigration(db);
    await seedIdentities(db);
    await attachInsertTrigger(db);

    const historical = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(historical.ok, historical.error).toBe(true);

    await prepareTransitionTypes(db);
    await applyCommissionMigration(db);
    await attachInsertTrigger(db);
    await attachTransitionTrigger(db);
    await seedPricingExtras(db);

    const afterMigrate = await snapshotOf(db, historical.id!);
    expect(afterMigrate.price_commission_percent).toBeNull();
    expect(afterMigrate.price_commission_amount).toBeNull();
    expect(afterMigrate.price_provider_net).toBeNull();

    const nullRate = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(nullRate.ok, nullRate.error).toBe(true);
    const nullSnap = await snapshotOf(db, nullRate.id!);
    expect(Number(nullSnap.price_subtotal)).toBe(200);
    expect(Number(nullSnap.price_extras_total)).toBe(EXTRA_FEE);
    expect(Number(nullSnap.price_travel_fee)).toBe(TRAVEL_FEE);
    expect(nullSnap.price_commission_percent).toBeNull();
    expect(nullSnap.price_commission_amount).toBeNull();
    expect(nullSnap.price_provider_net).toBeNull();

    await setCommissionPercent(db, FIXTURE_COMMISSION_PERCENT);
    const exact = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(exact.ok, exact.error).toBe(true);
    const exactSnap = await snapshotOf(db, exact.id!);
    const base = 200 + EXTRA_FEE;
    const commissionAmount = Number(((base * FIXTURE_COMMISSION_PERCENT) / 100).toFixed(2));
    const providerNet = base + TRAVEL_FEE - commissionAmount;
    expect(Number(exactSnap.price_commission_percent)).toBe(FIXTURE_COMMISSION_PERCENT);
    expect(Number(exactSnap.price_commission_amount)).toBe(commissionAmount);
    expect(Number(exactSnap.price_provider_net)).toBe(providerNet);
    expect(commissionAmount).toBe(31.25);
    expect(providerNet).toBe(258.75);

    await setCommissionPercent(db, 20);
    const afterRateChange = await snapshotOf(db, exact.id!);
    expect(Number(afterRateChange.price_commission_percent)).toBe(FIXTURE_COMMISSION_PERCENT);
    expect(Number(afterRateChange.price_commission_amount)).toBe(31.25);
    expect(Number(afterRateChange.price_provider_net)).toBe(258.75);

    const later = await insertBooking(db, {
      serviceId: IDS.cleaningService,
      familyMemberId: null,
    });
    expect(later.ok, later.error).toBe(true);
    const laterSnap = await snapshotOf(db, later.id!);
    expect(Number(laterSnap.price_commission_percent)).toBe(20);
    expect(Number(laterSnap.price_commission_amount)).toBe(50);
    expect(Number(laterSnap.price_provider_net)).toBe(240);

    const stillNull = await snapshotOf(db, nullRate.id!);
    expect(stillNull.price_provider_net).toBeNull();
  });

  it("ignores client-supplied snapshot values and rejects later updates", async () => {
    db = await createDisposableDb();
    await applySupabaseDefaultPrivileges(db);
    await applyBabysittingMigration(db);
    await seedIdentities(db);
    await prepareTransitionTypes(db);
    await applyCommissionMigration(db);
    await attachInsertTrigger(db);
    await attachTransitionTrigger(db);
    await seedPricingExtras(db);
    await setCommissionPercent(db, FIXTURE_COMMISSION_PERCENT);

    const suppliedId = await insertWithClientSnapshot(db, {
      percent: 99,
      amount: 1,
      net: 1,
      start: "2026-09-29T10:00:00Z",
    });
    const overwritten = await snapshotOf(db, suppliedId);
    expect(Number(overwritten.price_commission_percent)).toBe(FIXTURE_COMMISSION_PERCENT);
    expect(Number(overwritten.price_commission_amount)).toBe(31.25);
    expect(Number(overwritten.price_provider_net)).toBe(258.75);

    await db.exec("GRANT UPDATE ON TABLE public.bookings TO authenticated");
    const update = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.bookings SET price_commission_amount = 0 WHERE id = $1`,
      [suppliedId],
    );
    expect(update.ok).toBe(false);
    expect(update.error ?? "").toMatch(/cannot be changed after creation|permission denied/i);

    const insertAsClient = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.bookings (
         customer_id, provider_id, service_id, address_id,
         start_at, end_at, status, price_subtotal, price_discount, price_total,
         price_commission_percent, price_commission_amount, price_provider_net
       ) VALUES (
         $1, $2, $3, $4,
         '2026-09-30T10:00:00Z', '2026-09-30T12:00:00Z', 'pending', 0, 0, 0,
         5, 5, 5
       )`,
      [IDS.customer, IDS.provider, IDS.cleaningService, IDS.address],
    );
    expect(insertAsClient.ok).toBe(false);
  });

  it("clears supplied snapshot values when no rate is set", async () => {
    db = await createDisposableDb();
    await applySupabaseDefaultPrivileges(db);
    await applyBabysittingMigration(db);
    await seedIdentities(db);
    await prepareTransitionTypes(db);
    await applyCommissionMigration(db);
    await attachInsertTrigger(db);
    await seedPricingExtras(db);
    await setCommissionPercent(db, null);

    const suppliedId = await insertWithClientSnapshot(db, {
      percent: 99,
      amount: 1,
      net: 1,
      start: "2026-09-29T14:00:00Z",
    });
    const snap = await snapshotOf(db, suppliedId);
    expect(snap.price_commission_percent).toBeNull();
    expect(snap.price_commission_amount).toBeNull();
    expect(snap.price_provider_net).toBeNull();
  });
});
