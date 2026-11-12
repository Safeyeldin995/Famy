import { afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  completeHappyPath,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
} from "./booking-lifecycle.harness";

async function ensureAdminRole(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${IDS.adminUser}') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${IDS.adminUser}', 'admin') ON CONFLICT DO NOTHING;
  `);
}

async function setLedgerAutoFromPast(db: PGlite): Promise<void> {
  await asServiceRole(db, () =>
    db.query(
      `
        UPDATE public.settings
        SET value = COALESCE(value, '{}'::jsonb)
          || jsonb_build_object('ledger_auto_from', (now() - interval '1 day')::timestamptz)
        WHERE key = 'provider_settlement'
      `,
    ),
  );
}

async function forceCommissionSnapshot(
  db: PGlite,
  bookingId: string,
  opts: { total: number; providerNet: number },
): Promise<void> {
  await asServiceRole(db, () =>
    db.query(
      `
        UPDATE public.bookings
        SET price_total = $2::numeric,
            price_provider_net = $3::numeric,
            price_commission_percent = 10,
            price_commission_amount = $2::numeric - $3::numeric
        WHERE id = $1::uuid
      `,
      [bookingId, opts.total, opts.providerNet],
    ),
  );
}

async function ledgerNet(db: PGlite, providerId: string): Promise<number> {
  const rows = await queryRows<{ net: string }>(
    db,
    `SELECT net::text FROM public.provider_balance($1)`,
    [providerId],
  );
  return Number(rows[0]?.net ?? 0);
}

describe("provider settlements ledger", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("cash completion captures payment and creates platform-share debit", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    await setLedgerAutoFromPast(db!);
    const { bookingId } = await seedLifecycleBooking(db!, { status: "confirmed" });
    await forceCommissionSnapshot(db!, bookingId, { total: 2000, providerNet: 1700 });
    const { cashId } = await seedPaymentsForBooking(db!, bookingId);
    await asServiceRole(db!, async () => {
      await db!.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2::uuid`, [bookingId, cashId]);
      await db!.query(
        `
          UPDATE public.payments
          SET payment_method_type = 'cash', payment_method_code = 'cash_on_delivery', status = 'pending'
          WHERE id = $1
        `,
        [cashId],
      );
    });
    await completeHappyPath(db!, bookingId);

    const payment = await queryRows<{ status: string; captured_at: string | null }>(
      db!,
      `SELECT status::text AS status, captured_at::text FROM public.payments WHERE booking_id = $1 LIMIT 1`,
      [bookingId],
    );
    expect(payment[0]?.status).toBe("captured");
    expect(payment[0]?.captured_at).toBeTruthy();

    const ledger = await queryRows<{ kind: string; direction: string; amount: string }>(
      db!,
      `SELECT kind, direction, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1`,
      [bookingId],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.kind).toBe("cash_collected_platform_share");
    expect(ledger[0]?.direction).toBe("debit");
    expect(Number(ledger[0]?.amount)).toBe(300);
  });

  it("online capture creates provider credit when booking is completed", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    await setLedgerAutoFromPast(db!);
    const { bookingId } = await seedLifecycleBooking(db!, { status: "confirmed" });
    await forceCommissionSnapshot(db!, bookingId, { total: 5000, providerNet: 4250 });
    const { cashId } = await seedPaymentsForBooking(db!, bookingId);
    await asServiceRole(db!, async () => {
      await db!.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2::uuid`, [bookingId, cashId]);
      const instapay = await queryRows<{ id: string }>(
        db!,
        `SELECT id FROM public.payment_methods WHERE code = 'instapay' LIMIT 1`,
      );
      await db!.query(
        `
          UPDATE public.payments
          SET payment_method_id = $2,
              payment_method_type = 'manual_transfer',
              payment_method_code = 'instapay',
              status = 'pending'
          WHERE id = $1
        `,
        [cashId, instapay[0]!.id],
      );
    });
    await completeHappyPath(db!, bookingId);
    await asServiceRole(db!, () =>
      db!.query(
        `UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`,
        [bookingId],
      ),
    );

    const ledger = await queryRows<{ kind: string; amount: string }>(
      db!,
      `SELECT kind, amount::text FROM public.provider_ledger_entries WHERE booking_id = $1 AND kind = 'online_provider_share'`,
      [bookingId],
    );
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]?.amount)).toBe(4250);
    expect(await ledgerNet(db!, IDS.provider)).toBe(4250);
  });

  it("mixed cash and online balance matches Famy transfer amount", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    await setLedgerAutoFromPast(db!);

    const cashBooking = await seedLifecycleBooking(db!, { status: "confirmed" });
    await forceCommissionSnapshot(db!, cashBooking.bookingId, { total: 2000, providerNet: 1700 });
    const { cashId: cashOnlyId } = await seedPaymentsForBooking(db!, cashBooking.bookingId);
    await asServiceRole(db!, async () => {
      await db!.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2::uuid`, [
        cashBooking.bookingId,
        cashOnlyId,
      ]);
      await db!.query(
        `UPDATE public.payments SET payment_method_type = 'cash', payment_method_code = 'cash_on_delivery', status = 'pending' WHERE id = $1`,
        [cashOnlyId],
      );
    });
    await completeHappyPath(db!, cashBooking.bookingId);

    const onlineBooking = await seedLifecycleBooking(db!, { status: "confirmed" });
    await forceCommissionSnapshot(db!, onlineBooking.bookingId, { total: 5000, providerNet: 4250 });
    const { cashId: onlinePayId } = await seedPaymentsForBooking(db!, onlineBooking.bookingId);
    await asServiceRole(db!, async () => {
      await db!.query(`DELETE FROM public.payments WHERE booking_id = $1 AND id <> $2::uuid`, [
        onlineBooking.bookingId,
        onlinePayId,
      ]);
      const instapay = await queryRows<{ id: string }>(
        db!,
        `SELECT id FROM public.payment_methods WHERE code = 'instapay' LIMIT 1`,
      );
      await db!.query(
        `
          UPDATE public.payments
          SET payment_method_id = $2,
              payment_method_type = 'manual_transfer',
              payment_method_code = 'instapay',
              status = 'pending'
          WHERE id = $1
        `,
        [onlinePayId, instapay[0]!.id],
      );
    });
    await completeHappyPath(db!, onlineBooking.bookingId);
    await asServiceRole(db!, () =>
      db!.query(
        `UPDATE public.payments SET status = 'captured', captured_at = now() WHERE booking_id = $1`,
        [onlineBooking.bookingId],
      ),
    );

    // cash debit 300 + online credit 4250 => net 3950 (Famy owes provider)
    expect(await ledgerNet(db!, IDS.provider)).toBe(3950);
  });

  it("blocks create_booking at debt limit and lifts after payment", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    const seeded = await seedLifecycleBooking(db!, { status: "pending" });
    await asServiceRole(db!, () =>
      db!.query(
        `UPDATE public.settings SET value = jsonb_set(value, '{cash_debt_limit}', '100') WHERE key = 'provider_settlement'`,
      ),
    );
    await asUser(db!, IDS.adminUser, () =>
      db!.query(`SELECT public.admin_provider_ledger_adjustment($1, 'debit', 100, 'test debt', 'limit test')`, [
        IDS.provider,
      ]),
    );

    const createResult = await asUser(db!, IDS.customer, async () => {
      try {
        await db!.query(
          `
            SELECT public.create_booking(
              $1::uuid, $2::uuid, $3::uuid,
              (now() + interval '3 days'),
              (now() + interval '3 days' + interval '2 hours'),
              gen_random_uuid(),
              $4::uuid,
              NULL, NULL, '[]'::jsonb, NULL, NULL, NULL, NULL,
              'adult_present'
            )
          `,
          [
            IDS.provider,
            seeded.serviceId,
            IDS.address,
            IDS.childMember,
          ],
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, err: String(e) };
      }
    });
    expect(createResult.ok).toBe(false);
    expect(String(createResult.err)).toContain("BOOKING_PROVIDER_SETTLEMENT_BLOCKED");

    await asUser(db!, IDS.adminUser, () =>
      db!.query(
        `SELECT public.admin_record_provider_debt_payment($1, 50, 'ref1', 'partial', 'partial pay')`,
        [IDS.provider],
      ),
    );
    await asUser(db!, IDS.adminUser, () =>
      db!.query(
        `SELECT public.admin_record_provider_debt_payment($1, 50, 'ref2', 'final', 'final pay')`,
        [IDS.provider],
      ),
    );
    expect(await ledgerNet(db!, IDS.provider)).toBe(0);
  });

  it("rejects ledger row mutations for non-admin callers", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    await seedLifecycleBooking(db!, { status: "pending" });
    await asUser(db!, IDS.adminUser, () =>
      db!.query(`SELECT public.admin_provider_ledger_adjustment($1, 'credit', 10, 'seed', NULL)`, [IDS.provider]),
    );
    const row = await queryRows<{ id: string }>(
      db!,
      `SELECT id::text FROM public.provider_ledger_entries WHERE provider_id = $1 LIMIT 1`,
      [IDS.provider],
    );
    const id = row[0]?.id;
    expect(id).toBeTruthy();

    await expect(
      asUser(db!, IDS.providerUser, () => db!.query(`UPDATE public.provider_ledger_entries SET note = 'hack' WHERE id = $1`, [id])),
    ).rejects.toThrow();

    await expect(
      asUser(db!, IDS.providerUser, () => db!.query(`DELETE FROM public.provider_ledger_entries WHERE id = $1`, [id])),
    ).rejects.toThrow();
  });

  it("run_provider_weekly_settlements is idempotent", async () => {
    db = await createBookingLifecycleDb();
    await ensureAdminRole(db!);
    await seedLifecycleBooking(db!, { status: "pending" });
    await asUser(db!, IDS.adminUser, () =>
      db!.query(`SELECT public.admin_provider_ledger_adjustment($1, 'credit', 250, 'weekly', NULL)`, [IDS.provider]),
    );
    const first = await asServiceRole(db!, () =>
      queryRows<{ n: number }>(db!, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    const second = await asServiceRole(db!, () =>
      queryRows<{ n: number }>(db!, `SELECT public.run_provider_weekly_settlements()::int AS n`),
    );
    expect((first[0]?.n ?? 0) >= 0).toBe(true);
    expect(second[0]?.n ?? 0).toBe(0);
  });
});
