import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  completeHappyPath,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
} from "./booking-lifecycle.harness";

const BARE = {
  user: "00000000-0000-0000-0000-0000000000a1",
  provider: "00000000-0000-0000-0000-0000000000b1",
} as const;

const WEEKLY = {
  user: "00000000-0000-0000-0000-0000000000a2",
  provider: "00000000-0000-0000-0000-0000000000b2",
  owesUser: "00000000-0000-0000-0000-0000000000a3",
  owesProvider: "00000000-0000-0000-0000-0000000000b3",
} as const;

const DEBT_NET = {
  user: "00000000-0000-4000-8000-000000000099",
  provider: "00000000-0000-4000-8000-000000000199",
} as const;

type Balance = {
  total_credits: string;
  total_debits: string;
  net: string;
  cash_held_for_platform: string;
};

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.adminUser}', '{"full_name":"Lifecycle Admin"}'),
      ('${BARE.user}', '{"signup_role":"provider","full_name":"Bare Provider"}'),
      ('${WEEKLY.user}', '{"signup_role":"provider","full_name":"Weekly Provider"}'),
      ('${WEEKLY.owesUser}', '{"signup_role":"provider","full_name":"Owes Provider"}'),
      ('${DEBT_NET.user}', '{"signup_role":"provider","full_name":"Debt Net Provider"}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.adminUser}', 'admin')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.providers (
      id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode,
      min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar
    ) VALUES
      ('${BARE.provider}', '${BARE.user}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة'),
      ('${WEEKLY.provider}', '${WEEKLY.user}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة'),
      ('${WEEKLY.owesProvider}', '${WEEKLY.owesUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة'),
      ('${DEBT_NET.provider}', '${DEBT_NET.user}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
    ON CONFLICT (id) DO NOTHING;
  `);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function setLedgerCutoff(offset: string): Promise<void> {
  await asServiceRole(db, () =>
    db.query(
      `
        UPDATE public.settings
        SET value = COALESCE(value, '{}'::jsonb)
          || jsonb_build_object('ledger_auto_from', (now() + $1::interval)::timestamptz)
        WHERE key = 'provider_settlement'
      `,
      [offset],
    ),
  );
}

async function forceSnapshot(
  bookingId: string,
  total: number,
  providerNet: number,
): Promise<void> {
  await asServiceRole(db, () =>
    db.query(
      `
        UPDATE public.bookings
        SET price_total = $2::numeric,
            price_provider_net = $3::numeric,
            price_commission_percent = 10,
            price_commission_amount = ($2::numeric - $3::numeric)
        WHERE id = $1::uuid
      `,
      [bookingId, total, providerNet],
    ),
  );
}

async function insertPayment(
  bookingId: string,
  methodCode: "cash_on_delivery" | "instapay",
): Promise<string> {
  const methods = await queryRows<{ id: string }>(
    db,
    `SELECT id::text AS id FROM public.payment_methods WHERE code = $1`,
    [methodCode],
  );
  const methodId = methods[0]?.id;
  if (!methodId) throw new Error(`missing payment method ${methodCode}`);
  const totals = await queryRows<{ price_total: string }>(
    db,
    `SELECT price_total::text FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  const paymentId = randomUUID();
  await asServiceRole(db, () =>
    db.query(
      `
        INSERT INTO public.payments (
          id, booking_id, customer_id, amount, status, payment_method_id, metadata
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, 'pending', $5::uuid, '{}'::jsonb)
      `,
      [paymentId, bookingId, IDS.customer, totals[0]?.price_total ?? "0", methodId],
    ),
  );
  return paymentId;
}

async function balanceOf(providerId: string): Promise<Balance> {
  const rows = await queryRows<Balance>(
    db,
    `
      SELECT total_credits::text, total_debits::text, net::text, cash_held_for_platform::text
      FROM public.provider_balance($1::uuid)
    `,
    [providerId],
  );
  const row = rows[0];
  if (!row) throw new Error("provider_balance returned no row");
  return row;
}

async function notificationCount(userId: string, type: string): Promise<number> {
  const rows = await queryRows<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1::uuid AND type = $2`,
    [userId, type],
  );
  return rows[0]?.n ?? 0;
}

describe("provider settlements ledger", () => {
  it("stores settlement settings and schedules Sunday 10:00 Cairo", async () => {
    const settings = await queryRows<{ value: Record<string, unknown> }>(
      db,
      `SELECT value FROM public.settings WHERE key = 'provider_settlement'`,
    );
    const value = settings[0]?.value;
    expect(Number(value?.cash_debt_limit)).toBe(1000);
    expect(Number(value?.cash_debt_warn_percent)).toBe(80);
    expect(Number(value?.settlement_weekday)).toBe(0);
    expect(value?.ledger_auto_from).toBeTruthy();

    const jobs = await queryRows<{ schedule: string; command: string }>(
      db,
      `SELECT schedule, command FROM cron.job WHERE jobname = 'famy-provider-weekly-settlements'`,
    );
    expect(jobs[0]?.schedule).toBe("0 7,8 * * *");
    expect(jobs[0]?.command).toContain("run_provider_weekly_settlements");

    const privileges = await queryRows<{
      anon_admin: boolean;
      auth_insert: boolean;
      anon_insert: boolean;
    }>(
      db,
      `
        SELECT
          has_function_privilege(
            'anon',
            'public.admin_provider_ledger_adjustment(uuid, text, numeric, text, text)',
            'EXECUTE'
          ) AS anon_admin,
          has_table_privilege('authenticated', 'public.provider_ledger_entries', 'INSERT') AS auth_insert,
          has_table_privilege('anon', 'public.provider_ledger_entries', 'INSERT') AS anon_insert
      `,
    );
    expect(privileges[0]?.anon_admin).toBe(false);
    expect(privileges[0]?.auth_insert).toBe(false);
    expect(privileges[0]?.anon_insert).toBe(false);
  });

  it("posts cash debit and online credit, and Famy owes the net", async () => {
    await setLedgerCutoff("-1 day");
    // Both bookings are created before the cash debit posts. A 2000 platform
    // share is already over the 1000 debt limit, so a later create_booking
    // would be rejected while the existing online booking still completes.
    const cash = await seedLifecycleBooking(db, { status: "pending" });
    const online = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(cash.bookingId, 3500, 1500);
    const before = await queryRows<{ price_total: string; price_provider_net: string }>(
      db,
      `SELECT price_total::text, price_provider_net::text FROM public.bookings WHERE id = $1`,
      [cash.bookingId],
    );
    await insertPayment(cash.bookingId, "cash_on_delivery");
    await completeHappyPath(db, cash.bookingId);

    const after = await queryRows<{
      price_total: string;
      price_provider_net: string;
      status: string;
    }>(
      db,
      `
        SELECT b.price_total::text, b.price_provider_net::text, p.status::text AS status
        FROM public.bookings b
        JOIN public.payments p ON p.booking_id = b.id
        WHERE b.id = $1
      `,
      [cash.bookingId],
    );
    expect(after[0]?.price_total).toBe(before[0]?.price_total);
    expect(after[0]?.price_provider_net).toBe(before[0]?.price_provider_net);
    expect(after[0]?.status).toBe("captured");

    const cashLedger = await queryRows<{ kind: string; direction: string; amount: string }>(
      db,
      `SELECT kind, direction, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [cash.bookingId],
    );
    expect(cashLedger).toEqual([
      { kind: "cash_collected_platform_share", direction: "debit", amount: "2000.00" },
    ]);

    await forceSnapshot(online.bookingId, 6000, 5000);
    await insertPayment(online.bookingId, "instapay");
    await completeHappyPath(db, online.bookingId);
    const beforeCapture = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [online.bookingId],
    );
    expect(beforeCapture[0]?.n).toBe(0);

    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`,
        [online.bookingId],
      ),
    );
    const onlineLedger = await queryRows<{ kind: string; direction: string; amount: string }>(
      db,
      `SELECT kind, direction, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [online.bookingId],
    );
    expect(onlineLedger).toEqual([
      { kind: "online_provider_share", direction: "credit", amount: "5000.00" },
    ]);

    const balance = await balanceOf(IDS.provider);
    expect(Number(balance.total_credits)).toBe(5000);
    expect(Number(balance.total_debits)).toBe(2000);
    expect(Number(balance.net)).toBe(3000);
    expect(Number(balance.cash_held_for_platform)).toBe(2000);
  }, 60_000);

  it("leaves bookings completed before the cutoff, and rows with no snapshot, untouched", async () => {
    const historic = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(historic.bookingId, 2000, 1700);
    const pricesBefore = await queryRows<{ price_total: string; price_provider_net: string }>(
      db,
      `SELECT price_total::text, price_provider_net::text FROM public.bookings WHERE id = $1`,
      [historic.bookingId],
    );
    await insertPayment(historic.bookingId, "cash_on_delivery");
    await setLedgerCutoff("1 day");
    await completeHappyPath(db, historic.bookingId);

    const historicRows = await queryRows<{ n: number; pay: string; price_total: string }>(
      db,
      `
        SELECT
          (SELECT count(*)::int FROM public.provider_ledger_entries WHERE booking_id = $1) AS n,
          p.status::text AS pay,
          b.price_total::text
        FROM public.bookings b
        JOIN public.payments p ON p.booking_id = b.id
        WHERE b.id = $1
      `,
      [historic.bookingId],
    );
    expect(historicRows[0]?.n).toBe(0);
    expect(historicRows[0]?.pay).toBe("pending");
    expect(historicRows[0]?.price_total).toBe(pricesBefore[0]?.price_total);

    await setLedgerCutoff("-1 day");
    const unsnapshotted = await seedLifecycleBooking(db, { status: "pending" });
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings SET price_provider_net = NULL, price_commission_amount = NULL, price_commission_percent = NULL WHERE id = $1`,
        [unsnapshotted.bookingId],
      ),
    );
    await insertPayment(unsnapshotted.bookingId, "cash_on_delivery");
    await completeHappyPath(db, unsnapshotted.bookingId);
    const unsnap = await queryRows<{ n: number; pay: string }>(
      db,
      `
        SELECT
          (SELECT count(*)::int FROM public.provider_ledger_entries WHERE booking_id = $1) AS n,
          status::text AS pay
        FROM public.payments WHERE booking_id = $1
      `,
      [unsnapshotted.bookingId],
    );
    expect(unsnap[0]?.n).toBe(0);
    expect(unsnap[0]?.pay).toBe("pending");
  }, 60_000);

  it("warns once per crossing of 80 percent", async () => {
    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'debit', 800, 'warn seed', 'first')`,
        [BARE.provider],
      ),
    );
    expect(await notificationCount(BARE.user, "provider_settlement_debt_warning")).toBe(1);
    const body = await queryRows<{ body_ar: string }>(
      db,
      `SELECT body_ar FROM public.notifications WHERE user_id = $1::uuid AND type = 'provider_settlement_debt_warning'`,
      [BARE.user],
    );
    expect(body[0]?.body_ar).toBe(
      "رصيدك المستحق للمنصة قرب يوصل للحد، حول المبلغ عشان تفضل تستقبل طلبات",
    );

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'debit', 50, 'still warning', 'second')`,
        [BARE.provider],
      ),
    );
    expect(await notificationCount(BARE.user, "provider_settlement_debt_warning")).toBe(1);

    const audited = await queryRows<{ n: number }>(
      db,
      `
        SELECT count(*)::int AS n FROM public.audit_logs
        WHERE entity = 'provider_ledger_entries' AND reason = 'warn seed'
      `,
    );
    expect(audited[0]?.n).toBeGreaterThan(0);

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'credit', 250, 'below warning', 'relief')`,
        [BARE.provider],
      ),
    );
    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'debit', 250, 'cross again', 'again')`,
        [BARE.provider],
      ),
    );
    expect(await notificationCount(BARE.user, "provider_settlement_debt_warning")).toBe(2);
  });

  it("blocks new bookings at the limit and lifts the block after payment", async () => {
    const existing = await seedLifecycleBooking(db, { providerId: IDS.otherProvider, status: "pending" });
    const visibleBefore = await asUser(db, IDS.customer, () =>
      queryRows<{ id: string }>(
        db,
        `SELECT id::text FROM public.search_marketplace_providers(NULL, $1::uuid) WHERE id = $2::uuid`,
        [IDS.address, IDS.otherProvider],
      ),
    );
    expect(visibleBefore.length).toBeGreaterThan(0);

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'debit', 1000, 'hit limit', 'limit')`,
        [IDS.otherProvider],
      ),
    );
    expect(await notificationCount(IDS.otherProviderUser, "provider_settlement_debt_blocked")).toBe(1);

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'debit', 100, 'still blocked', 'more')`,
        [IDS.otherProvider],
      ),
    );
    expect(await notificationCount(IDS.otherProviderUser, "provider_settlement_debt_blocked")).toBe(1);

    const hidden = await asUser(db, IDS.customer, () =>
      queryRows<{ id: string }>(
        db,
        `SELECT id::text FROM public.search_marketplace_providers(NULL, $1::uuid) WHERE id = $2::uuid`,
        [IDS.address, IDS.otherProvider],
      ),
    );
    expect(hidden).toEqual([]);

    const bookable = await asUser(db, IDS.customer, () =>
      queryRows<{ service_id: string }>(
        db,
        `SELECT service_id::text FROM public.marketplace_provider_bookable_services($1::uuid, $2::uuid)`,
        [IDS.otherProvider, IDS.address],
      ),
    );
    expect(bookable).toEqual([]);

    const rejected = await asUser(db, IDS.customer, async () => {
      try {
        await db.query(
          `
            SELECT public.create_booking(
              $1::uuid, $2::uuid, $3::uuid,
              now() + interval '4 days',
              now() + interval '4 days' + interval '2 hours',
              gen_random_uuid(),
              $4::uuid,
              NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL,
              'adult_present'
            )
          `,
          [IDS.otherProvider, existing.serviceId, IDS.address, IDS.childMember],
        );
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain("BOOKING_PROVIDER_SETTLEMENT_BLOCKED");

    const stillPending = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.bookings WHERE id = $1`,
      [existing.bookingId],
    );
    expect(stillPending[0]?.status).toBe("pending");

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_record_provider_debt_payment($1::uuid, 1100, 'BANK-1', 'paid down', 'settled')`,
        [IDS.otherProvider],
      ),
    );
    expect(Number((await balanceOf(IDS.otherProvider)).net)).toBe(0);

    const visibleAfter = await asUser(db, IDS.customer, () =>
      queryRows<{ id: string }>(
        db,
        `SELECT id::text FROM public.search_marketplace_providers(NULL, $1::uuid) WHERE id = $2::uuid`,
        [IDS.address, IDS.otherProvider],
      ),
    );
    expect(visibleAfter.length).toBeGreaterThan(0);

    const created = await asUser(db, IDS.customer, () =>
      queryRows<{ result: { booking_id?: string } }>(
        db,
        `
          SELECT public.create_booking(
            $1::uuid, $2::uuid, $3::uuid,
            now() + interval '5 days',
            now() + interval '5 days' + interval '2 hours',
            gen_random_uuid(),
            $4::uuid,
            NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL,
            'adult_present'
          ) AS result
        `,
        [IDS.otherProvider, existing.serviceId, IDS.address, IDS.childMember],
      ),
    );
    expect(created[0]?.result?.booking_id).toBeTruthy();
  }, 60_000);

  it("creates one weekly settlement per provider and a second run is a no-op", async () => {
    const period = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `SELECT period_start::text, period_end::text FROM public.provider_settlement_closed_period()`,
    );
    const periodStart = period[0]?.period_start;
    const periodEnd = period[0]?.period_end;
    expect(periodStart).toBeTruthy();
    expect(new Date(periodEnd ?? 0).getTime()).toBeLessThanOrEqual(Date.now());

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (
          provider_id, kind, direction, amount, payment_method, created_at
        ) VALUES
          ($1::uuid, 'cash_collected_platform_share', 'debit', 2000, 'cash', $3::timestamptz + interval '1 hour'),
          ($1::uuid, 'online_provider_share', 'credit', 5000, 'instapay', $3::timestamptz + interval '2 hours'),
          ($1::uuid, 'adjustment', 'credit', 25, NULL, now()),
          ($2::uuid, 'cash_collected_platform_share', 'debit', 400, 'cash', $3::timestamptz + interval '3 hours')
      `,
      [WEEKLY.provider, WEEKLY.owesProvider, periodStart],
    );

    const first = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const second = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    expect(first[0]?.n).toBe(2);
    expect(second[0]?.n).toBe(0);

    const owed = await queryRows<{ amount: string; direction: string; status: string }>(
      db,
      `
        SELECT amount::text, direction, status
        FROM public.provider_settlements
        WHERE provider_id = $1::uuid
      `,
      [WEEKLY.provider],
    );
    expect(owed).toEqual([
      { amount: "3000.00", direction: "famy_pays_provider", status: "pending" },
    ]);

    const owes = await queryRows<{ amount: string; direction: string }>(
      db,
      `SELECT amount::text, direction FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [WEEKLY.owesProvider],
    );
    expect(owes).toEqual([{ amount: "400.00", direction: "provider_pays_famy" }]);

    const open = await queryRows<{ n: number }>(
      db,
      `
        SELECT count(*)::int AS n FROM public.provider_ledger_entries
        WHERE provider_id = $1::uuid AND settlement_id IS NULL AND kind = 'adjustment'
      `,
      [WEEKLY.provider],
    );
    expect(open[0]?.n).toBe(1);

    const settlementId = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [WEEKLY.provider],
    );
    const missing = await asUser(db, IDS.providerUser, async () => {
      try {
        await db.query(
          `SELECT public.admin_mark_provider_settlement_settled($1::uuid, 'REF', NULL, 'reason')`,
          [settlementId[0]?.id],
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toBe(true);

    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_mark_provider_settlement_settled($1::uuid, 'INSTAPAY-9', 'weekly transfer', 'paid the provider')`,
        [settlementId[0]?.id],
      ),
    );
    const paid = await queryRows<{ status: string; note: string | null }>(
      db,
      `SELECT status, note FROM public.provider_settlements WHERE id = $1::uuid`,
      [settlementId[0]?.id],
    );
    expect(paid[0]?.status).toBe("paid");
    expect(paid[0]?.note).toBe("weekly transfer");
    const afterPay = await balanceOf(WEEKLY.provider);
    // 5000 credit - 2000 cash debit - 3000 payout + 25 open adjustment = 25
    expect(Number(afterPay.net)).toBe(25);
    expect(Number(afterPay.cash_held_for_platform)).toBe(2000);
    expect(await notificationCount(WEEKLY.user, "provider_settlement_created")).toBe(1);
    expect(await notificationCount(WEEKLY.user, "provider_settlement_settled")).toBe(1);
  });

  it("rejects ledger edits and hides other providers from non-admins", async () => {
    const row = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.provider_ledger_entries WHERE provider_id = $1::uuid LIMIT 1`,
      [IDS.provider],
    );
    const id = row[0]?.id;
    expect(id).toBeTruthy();

    await expect(
      db.query(`UPDATE public.provider_ledger_entries SET note = 'hack' WHERE id = $1::uuid`, [id]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.query(`DELETE FROM public.provider_ledger_entries WHERE id = $1::uuid`, [id]),
    ).rejects.toThrow(/immutable/i);

    const asOther = await asUser(db, IDS.otherProviderUser, () =>
      queryRows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE provider_id = $1::uuid`,
        [IDS.provider],
      ),
    );
    expect(asOther[0]?.n).toBe(0);

    const asOwner = await asUser(db, IDS.providerUser, () =>
      queryRows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE provider_id = $1::uuid`,
        [IDS.provider],
      ),
    );
    expect(asOwner[0]?.n).toBeGreaterThan(0);

    const asAdmin = await asUser(db, IDS.adminUser, () =>
      queryRows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE provider_id = $1::uuid`,
        [IDS.provider],
      ),
    );
    expect(asAdmin[0]?.n).toBe(asOwner[0]?.n);

    await expect(
      asUser(db, IDS.customer, () =>
        db.query(`SELECT * FROM public.provider_balance($1::uuid)`, [IDS.provider]),
      ),
    ).rejects.toThrow(/not visible/i);

    await expect(
      asUser(db, IDS.providerUser, () =>
        db.query(
          `SELECT public.admin_provider_ledger_adjustment($1::uuid, 'credit', 1, 'nope', NULL)`,
          [IDS.provider],
        ),
      ),
    ).rejects.toThrow(/Admin required/i);
  });

  it("nets cash debits with debt repayments in the same closed week", async () => {
    const period = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `SELECT period_start::text, period_end::text FROM public.provider_settlement_closed_period()`,
    );
    const periodStart = period[0]?.period_start;
    expect(periodStart).toBeTruthy();

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (
          provider_id, kind, direction, amount, payment_method, created_at
        ) VALUES ($1::uuid, 'cash_collected_platform_share', 'debit', 400, 'cash', $2::timestamptz + interval '1 hour')
      `,
      [DEBT_NET.provider, periodStart],
    );
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (
          provider_id, kind, direction, amount, payment_method, note, created_at
        ) VALUES ($1::uuid, 'debt_payment_received', 'credit', 400, 'manual_transfer', 'REF-400', $2::timestamptz + interval '2 hours')
      `,
      [DEBT_NET.provider, periodStart],
    );

    const created = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    expect(created[0]?.n).toBe(0);

    const pending = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_settlements WHERE provider_id = $1::uuid AND status = 'pending'`,
      [DEBT_NET.provider],
    );
    expect(pending[0]?.n).toBe(0);
    expect(Number((await balanceOf(DEBT_NET.provider)).net)).toBe(0);

    const unlinked = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE provider_id = $1::uuid AND settlement_id IS NULL`,
      [DEBT_NET.provider],
    );
    expect(unlinked[0]?.n).toBe(0);
  });

  it("reconciles ledger shares after ledger cutoff moves forward", async () => {
    await setLedgerCutoff("2 days");
    const booking = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(booking.bookingId, 1000, 850);
    await insertPayment(booking.bookingId, "instapay");
    await completeHappyPath(db, booking.bookingId);
    await asServiceRole(db, () =>
      db.query(`UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`, [
        booking.bookingId,
      ]),
    );
    const empty = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [booking.bookingId],
    );
    expect(empty[0]?.n).toBe(0);
    await setLedgerCutoff("-1 day");
    await asUser(db, IDS.adminUser, () =>
      db.query(`SELECT public.admin_reconcile_booking_ledger($1::uuid, 'catch-up')`, [booking.bookingId]),
    );
    const rows = await queryRows<{ kind: string; amount: string }>(
      db,
      `SELECT kind, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [booking.bookingId],
    );
    expect(rows).toEqual([{ kind: "online_provider_share", amount: "850.00" }]);
  });

  it("historic cash ledger does not capture payments and rejects online bookings", async () => {
    await setLedgerCutoff("2 days");
    const historic = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(historic.bookingId, 1000, 850);
    await insertPayment(historic.bookingId, "cash_on_delivery");
    await completeHappyPath(db, historic.bookingId);
    const payBefore = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.payments WHERE booking_id = $1`,
      [historic.bookingId],
    );
    await asUser(db, IDS.adminUser, () =>
      db.query(`SELECT public.admin_record_historic_cash_collected($1::uuid, 'historic cash', NULL)`, [
        historic.bookingId,
      ]),
    );
    const payAfter = await queryRows<{ status: string }>(
      db,
      `SELECT status::text AS status FROM public.payments WHERE booking_id = $1`,
      [historic.bookingId],
    );
    expect(payAfter[0]?.status).toBe(payBefore[0]?.status);

    const online = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(online.bookingId, 1000, 850);
    const payId = await insertPayment(online.bookingId, "instapay");
    await asServiceRole(db, () =>
      db.query(`UPDATE public.payments SET payment_method_type = 'online' WHERE id = $1::uuid`, [payId]),
    );
    await completeHappyPath(db, online.bookingId);
    await asServiceRole(db, () =>
      db.query(`UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`, [
        online.bookingId,
      ]),
    );
    await expect(
      asUser(db, IDS.adminUser, () =>
        db.query(`SELECT public.admin_record_historic_cash_collected($1::uuid, 'nope', NULL)`, [online.bookingId]),
      ),
    ).rejects.toThrow(/cash payment/i);
    await setLedgerCutoff("-1 day");
  });

  it("aligns Cairo weekly boundaries without timestamptz drift", async () => {
    const closed = await queryRows<{ period_start: string; period_end: string; next_settlement_at: string }>(
      db,
      `SELECT period_start::text, period_end::text, next_settlement_at::text FROM public.provider_settlement_closed_period()`,
    );
    const boundary = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `
        SELECT pc.period_start::text, pc.period_end::text
        FROM public.provider_settlement_closed_period() c,
             public.provider_settlement_period_containing(c.period_end + interval '1 hour') pc
      `,
    );
    expect(boundary[0]?.period_start).toBe(closed[0]?.period_end);

    const dstEdge = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `
        SELECT period_start::text, period_end::text
        FROM public.provider_settlement_period_containing(timestamptz '2026-10-25 09:00:00+03')
      `,
    );
    const dstNext = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `
        SELECT period_start::text, period_end::text
        FROM public.provider_settlement_period_containing(timestamptz '2026-11-01 09:30:00+02')
      `,
    );
    expect(new Date(dstEdge[0]!.period_end).toISOString()).toBe(new Date(dstNext[0]!.period_start).toISOString());
    expect(
      (new Date(closed[0]!.next_settlement_at).getTime() - new Date(closed[0]!.period_end).getTime()) /
        3600000,
    ).toBe(168);
  });

  it("settles missed closed weeks in one run", async () => {
    const periods = await queryRows<{ closed_start: string; prev_start: string; prev_end: string }>(
      db,
      `
        SELECT
          c.period_start::text AS closed_start,
          pc.period_start::text AS prev_start,
          pc.period_end::text AS prev_end
        FROM public.provider_settlement_closed_period() c,
             public.provider_settlement_period_containing(c.period_start - interval '1 second') pc
      `,
    );
    const closedStart = periods[0]?.closed_start;
    const prevStart = periods[0]?.prev_start;
    expect(closedStart).toBeTruthy();
    expect(prevStart).toBeTruthy();

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'cash_collected_platform_share', 'debit', 50, $2::timestamptz + interval '1 hour')
      `,
      [WEEKLY.owesProvider, prevStart],
    );
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'cash_collected_platform_share', 'debit', 60, $2::timestamptz + interval '1 hour')
      `,
      [WEEKLY.owesProvider, closedStart],
    );

    const before = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [WEEKLY.owesProvider],
    );
    const n = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    expect((n[0]?.n ?? 0) >= 1).toBe(true);
    const after = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [WEEKLY.owesProvider],
    );
    expect((after[0]?.n ?? 0) - (before[0]?.n ?? 0) >= 1).toBe(true);
  });

  it("applies cash platform share for completion-then-capture", async () => {
    await setLedgerCutoff("-1 day");
    const booking = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(booking.bookingId, 3500, 1500);
    await completeHappyPath(db, booking.bookingId);
    const beforePayment = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1::uuid`,
      [booking.bookingId],
    );
    expect(beforePayment[0]?.n).toBe(0);
    await insertPayment(booking.bookingId, "cash_on_delivery");
    await asServiceRole(db, () =>
      db.query(`UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`, [
        booking.bookingId,
      ]),
    );
    const cashShare = await queryRows<{ kind: string; amount: string }>(
      db,
      `SELECT kind, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1::uuid`,
      [booking.bookingId],
    );
    expect(cashShare).toEqual([{ kind: "cash_collected_platform_share", amount: "2000.00" }]);
  });

  it("applies one online share for completion-then-capture and double apply", async () => {
    await setLedgerCutoff("-1 day");
    const booking = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(booking.bookingId, 1000, 850);
    await insertPayment(booking.bookingId, "instapay");
    await completeHappyPath(db, booking.bookingId);
    const beforeCapture = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1::uuid AND kind = 'online_provider_share'`,
      [booking.bookingId],
    );
    expect(beforeCapture[0]?.n).toBe(0);
    await asServiceRole(db, () =>
      db.query(`UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`, [
        booking.bookingId,
      ]),
    );
    const afterCapture = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1::uuid AND kind = 'online_provider_share'`,
      [booking.bookingId],
    );
    expect(afterCapture[0]?.n).toBe(1);
    await db.query(`SELECT public.ledger_apply_booking_shares($1::uuid)`, [booking.bookingId]);
    const afterSecondApply = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE booking_id = $1::uuid AND kind = 'online_provider_share'`,
      [booking.bookingId],
    );
    expect(afterSecondApply[0]?.n).toBe(1);
    // Paymob capture runs inside a payment UPDATE (payment lock first). Manual capture is
    // rejected until the booking is completed, so PGlite cannot open two connections to
    // deadlock completion+capture; the advisory lock is covered by capture-then-reapply above.
  });

  it("marks a settlement settled when the internal note is omitted", async () => {
    const noteProvider = "00000000-0000-4000-8000-000000000296";
    const noteUser = "00000000-0000-4000-8000-000000000196";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${noteUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${noteProvider}', '${noteUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    const period = await queryRows<{ period_start: string }>(
      db,
      `SELECT period_start::text FROM public.provider_settlement_closed_period()`,
    );
    const periodStart = period[0]?.period_start;
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'online_provider_share', 'credit', 120, $2::timestamptz + interval '1 hour')
      `,
      [noteProvider, periodStart],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const settlement = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [noteProvider],
    );
    await asUser(db, IDS.adminUser, () =>
      db.query(
        `SELECT public.admin_mark_provider_settlement_settled($1::uuid, 'WIRE-12', NULL, 'paid out')`,
        [settlement[0]?.id],
      ),
    );
    const row = await queryRows<{ status: string; note: string | null; reference: string }>(
      db,
      `SELECT status, note, payment_reference AS reference FROM public.provider_settlements WHERE id = $1::uuid`,
      [settlement[0]?.id],
    );
    expect(row[0]?.status).toBe("paid");
    expect(row[0]?.note).toBeNull();
    expect(row[0]?.reference).toBe("WIRE-12");
  });

  it("rolls late ledger entries into the next settlement without changing prior period", async () => {
    const rollProvider = "00000000-0000-4000-8000-000000000297";
    const rollUser = "00000000-0000-4000-8000-000000000197";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${rollUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${rollProvider}', '${rollUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    const periods = await queryRows<{
      week1_start: string;
      week1_end: string;
      week2_start: string;
      week2_end: string;
    }>(
      db,
      `
        SELECT
          pc.period_start::text AS week1_start,
          pc.period_end::text AS week1_end,
          c.period_start::text AS week2_start,
          c.period_end::text AS week2_end
        FROM public.provider_settlement_closed_period() c,
             public.provider_settlement_period_containing(c.period_start - interval '1 second') pc
      `,
    );
    const week1Start = periods[0]?.week1_start;
    const week1End = periods[0]?.week1_end;
    const week2Start = periods[0]?.week2_start;
    expect(week1Start).toBeTruthy();
    expect(week2Start).toBeTruthy();

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'online_provider_share', 'credit', 1000, $2::timestamptz + interval '1 hour')
      `,
      [rollProvider, week1Start],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const week1 = await queryRows<{ amount: string; id: string }>(
      db,
      `
        SELECT amount::text, id::text
        FROM public.provider_settlements
        WHERE provider_id = $1::uuid AND period_start = $2::timestamptz AND period_end = $3::timestamptz
      `,
      [rollProvider, week1Start, week1End],
    );
    expect(week1[0]?.amount).toBe("1000.00");

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'online_provider_share', 'credit', 850, $2::timestamptz + interval '2 hours')
      `,
      [rollProvider, week1Start],
    );

    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );

    const week1After = await queryRows<{ amount: string; status: string }>(
      db,
      `SELECT amount::text, status FROM public.provider_settlements WHERE id = $1::uuid`,
      [week1[0]?.id],
    );
    expect(week1After[0]?.amount).toBe("1000.00");
    expect(week1After[0]?.status).toBe("pending");

    const week2 = await queryRows<{ amount: string }>(
      db,
      `
        SELECT amount::text FROM public.provider_settlements
        WHERE provider_id = $1::uuid AND period_start = $2::timestamptz
      `,
      [rollProvider, week2Start],
    );
    expect(week2[0]?.amount).toBe("850.00");
    const linkedLate = await queryRows<{ n: number }>(
      db,
      `
        SELECT count(*)::int AS n FROM public.provider_ledger_entries
        WHERE provider_id = $1::uuid AND amount = 850 AND settlement_id IS NOT NULL
      `,
      [rollProvider],
    );
    expect(linkedLate[0]?.n).toBe(1);
  });

  it("does not change an existing pending settlement on a second weekly run", async () => {
    const pendingProvider = "00000000-0000-4000-8000-000000000298";
    const pendingUser = "00000000-0000-4000-8000-000000000198";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${pendingUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${pendingProvider}', '${pendingUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    const period = await queryRows<{ period_start: string; period_end: string }>(
      db,
      `SELECT period_start::text, period_end::text FROM public.provider_settlement_closed_period()`,
    );
    const periodStart = period[0]?.period_start;
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'online_provider_share', 'credit', 3000, $2::timestamptz + interval '1 hour')
      `,
      [pendingProvider, periodStart],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const first = await queryRows<{ amount: string; status: string }>(
      db,
      `SELECT amount::text, status FROM public.provider_settlements WHERE provider_id = $1::uuid AND period_start = $2::timestamptz`,
      [pendingProvider, periodStart],
    );
    expect(first[0]?.status).toBe("pending");
    expect(first[0]?.amount).toBe("3000.00");

    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'debt_payment_received', 'credit', 3000, $2::timestamptz + interval '2 hours')
      `,
      [pendingProvider, periodStart],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const second = await queryRows<{ amount: string; status: string }>(
      db,
      `SELECT amount::text, status FROM public.provider_settlements WHERE provider_id = $1::uuid AND period_start = $2::timestamptz`,
      [pendingProvider, periodStart],
    );
    expect(second[0]?.status).toBe("pending");
    expect(second[0]?.amount).toBe("3000.00");
    expect(second[0]?.amount).toBe(first[0]?.amount);
  });

  it("reports online platform share in admin finance summary", async () => {
    const booking = await seedLifecycleBooking(db, { status: "pending" });
    await forceSnapshot(booking.bookingId, 1000, 850);
    await asServiceRole(db, () =>
      db.query(`UPDATE public.bookings SET status = 'completed', completed_at = now() WHERE id = $1::uuid`, [
        booking.bookingId,
      ]),
    );
    const at = "2099-07-15T10:00:00.000Z";
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (
          provider_id, booking_id, kind, direction, amount, payment_method, created_at
        ) VALUES ($1::uuid, $2::uuid, 'online_provider_share', 'credit', 850, 'instapay', $3::timestamptz)
      `,
      [IDS.provider, booking.bookingId, at],
    );
    const from = "2099-07-15T09:00:00.000Z";
    const to = "2099-07-15T11:00:00.000Z";
    const summary = await asUser(db, IDS.adminUser, () =>
      queryRows<{ platform_share: string }>(
        db,
        `SELECT (public.admin_finance_summary($1::timestamptz, $2::timestamptz)->>'platform_share') AS platform_share`,
        [from, to],
      ),
    );
    expect(summary[0]?.platform_share).toBe("150.00");
  });

  it("does not settle entries in the open week when the closed period is already caught up", async () => {
    const openProvider = "00000000-0000-4000-8000-000000000293";
    const openUser = "00000000-0000-4000-8000-000000000193";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${openUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${openProvider}', '${openUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES ($1::uuid, 'online_provider_share', 'credit', 999, now())
      `,
      [openProvider],
    );
    const before = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [openProvider],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const after = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [openProvider],
    );
    expect(after[0]?.n).toBe(before[0]?.n);
    const unlinked = await queryRows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM public.provider_ledger_entries WHERE provider_id = $1::uuid AND settlement_id IS NULL`,
      [openProvider],
    );
    expect(unlinked[0]?.n).toBe(1);
  });

  it("run_provider_weekly_settlements snapshots entry ids before linking", async () => {
    const def = await queryRows<{ def: string }>(
      db,
      `SELECT pg_get_functiondef('public.run_provider_weekly_settlements()'::regprocedure) AS def`,
    );
    expect(def[0]?.def).toContain("v_entry_ids");
    expect(def[0]?.def).toContain("e.id = ANY (v_entry_ids)");
    // PGlite cannot interleave a ledger insert between SUM and UPDATE inside one RPC transaction;
    // the uuid[] snapshot in the function is the concurrency guard.
  });

  it("links settlement amount to exactly the snapshotted ledger rows", async () => {
    const snapProvider = "00000000-0000-4000-8000-000000000295";
    const snapUser = "00000000-0000-4000-8000-000000000195";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${snapUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${snapProvider}', '${snapUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    const period = await queryRows<{ period_start: string }>(
      db,
      `SELECT period_start::text FROM public.provider_settlement_closed_period()`,
    );
    const periodStart = period[0]?.period_start;
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (provider_id, kind, direction, amount, created_at)
        VALUES
          ($1::uuid, 'online_provider_share', 'credit', 700, $2::timestamptz + interval '1 hour'),
          ($1::uuid, 'online_provider_share', 'credit', 300, $2::timestamptz + interval '2 hours')
      `,
      [snapProvider, periodStart],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const settlement = await queryRows<{ amount: string; id: string }>(
      db,
      `SELECT amount::text, id::text FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [snapProvider],
    );
    expect(settlement[0]?.amount).toBe("1000.00");
    const linked = await queryRows<{ n: number; sum: string }>(
      db,
      `
        SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS sum
        FROM public.provider_ledger_entries
        WHERE settlement_id = $1::uuid
      `,
      [settlement[0]?.id],
    );
    expect(linked[0]?.n).toBe(2);
    expect(linked[0]?.sum).toBe("1000.00");
  });

  it("hides internal notes from providers but exposes them to admin list RPCs", async () => {
    const secretProvider = "00000000-0000-4000-8000-000000000294";
    const secretUser = "00000000-0000-4000-8000-000000000194";
    await db.exec(`
      INSERT INTO auth.users (id) VALUES ('${secretUser}') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.providers (id, profile_id, hourly_rate, onboarding_status, is_active, vacation_mode, min_notice_hours, max_advance_days, buffer_minutes, bio_en, bio_ar)
      VALUES ('${secretProvider}', '${secretUser}', 100, 'DRAFT', true, false, 0, 365, 0, 'Bio', 'سيرة')
      ON CONFLICT (id) DO NOTHING;
    `);
    const period = await queryRows<{ period_start: string }>(
      db,
      `SELECT period_start::text FROM public.provider_settlement_closed_period()`,
    );
    await db.query(
      `
        INSERT INTO public.provider_ledger_entries (
          provider_id, kind, direction, amount, note, created_at
        ) VALUES ($1::uuid, 'adjustment', 'credit', 50, 'ledger-admin-only', $2::timestamptz)
      `,
      [secretProvider, period[0]?.period_start],
    );
    await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const settlementId = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.provider_settlements WHERE provider_id = $1::uuid`,
      [secretProvider],
    );
    await db.query(`UPDATE public.provider_settlements SET note = 'settlement-admin-only' WHERE id = $1::uuid`, [
      settlementId[0]?.id,
    ]);

    await expect(
      asUser(db, secretUser, () =>
        db.query(
          `SELECT note FROM public.provider_settlements WHERE provider_id = $1::uuid LIMIT 1`,
          [secretProvider],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asUser(db, secretUser, () =>
        db.query(
          `SELECT note FROM public.provider_ledger_entries WHERE provider_id = $1::uuid LIMIT 1`,
          [secretProvider],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    const adminSettlements = await asUser(db, IDS.adminUser, () =>
      queryRows<{ data: unknown }>(
        db,
        `SELECT public.admin_list_provider_settlements($1::uuid) AS data`,
        [secretProvider],
      ),
    );
    const settlementsJson = adminSettlements[0]?.data as Array<{ note?: string }>;
    expect(settlementsJson?.[0]?.note).toBe("settlement-admin-only");

    const adminLedger = await asUser(db, IDS.adminUser, () =>
      queryRows<{ data: unknown }>(
        db,
        `SELECT public.admin_list_provider_ledger_entries($1::uuid, 10) AS data`,
        [secretProvider],
      ),
    );
    const ledgerJson = adminLedger[0]?.data as Array<{ note?: string }>;
    expect(ledgerJson?.[0]?.note).toBe("ledger-admin-only");
  });
});
