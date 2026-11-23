import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { paymentSituationFixtures } from "@/lib/payments/paymentSituationFixtures";

let db: PGlite;
let bookingId: string;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES
      ('${IDS.adminUser}', '{"full_name":"Lifecycle Admin"}')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${IDS.adminUser}', 'admin')
    ON CONFLICT DO NOTHING;
  `);
  const seeded = await seedLifecycleBooking(db);
  bookingId = seeded.bookingId;
  await completeHappyPath(db, bookingId);
}, 180_000);

afterAll(async () => db?.close());

describe("admin daily operations RPCs", () => {
  it("provider statement closing matches provider_balance net independently", async () => {
    const from = "2020-01-01T00:00:00.000Z";
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const rows = await asUser(db, IDS.adminUser, async () => {
      const [statementRows, balanceRows] = await Promise.all([
        queryRows<{ statement: { closing_balance: number } }>(
          db,
          `SELECT public.admin_provider_statement($1::uuid, $2::timestamptz, $3::timestamptz) AS statement`,
          [IDS.provider, from, to],
        ),
        queryRows<{ net: string }>(
          db,
          `SELECT net::text AS net FROM public.provider_balance($1::uuid)`,
          [IDS.provider],
        ),
      ]);
      return { statement: statementRows[0]?.statement, net: balanceRows[0]?.net };
    });
    const asOf = await asUser(db, IDS.adminUser, () =>
      queryRows<{ net: string }>(
        db,
        `SELECT public.provider_net_as_of($1::uuid, $2::timestamptz)::text AS net`,
        [IDS.provider, to],
      ),
    );
    expect(rows.statement?.closing_balance).toBe(Number(asOf[0]?.net));
    expect(Number(rows.net)).toBe(Number(asOf[0]?.net));
  });

  it("admin_reports exact completed totals for an isolated completed_at window", async () => {
    const isolatedCompletedAt = "2099-07-15T12:00:00.000Z";
    await asServiceRole(db, () =>
      db.query(`UPDATE public.bookings SET completed_at = $1::timestamptz WHERE id = $2`, [
        isolatedCompletedAt,
        bookingId,
      ]),
    );
    const booking = await queryRows<{ commission: string; total: string }>(
      db,
      `SELECT price_commission_amount::text AS commission, price_total::text AS total
         FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    const commission = Number(booking[0]?.commission ?? 0);
    const total = Number(booking[0]?.total ?? 0);
    const from = "2099-07-15T00:00:00.000Z";
    const to = "2099-07-16T00:00:00.000Z";
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{
        report: {
          buckets: Array<{ bucket_start: string; platform_commission: number; revenue: number; bookings_completed: number }>;
          totals: { bookings_completed: number; platform_commission: number; revenue: number };
        };
      }>(
        db,
        `SELECT public.admin_reports($1::timestamptz, $2::timestamptz, 'day') AS report`,
        [from, to],
      ),
    );
    const report = rows[0]?.report;
    expect(report?.totals.bookings_completed).toBe(1);
    expect(report?.totals.revenue).toBe(total);
    expect(report?.totals.platform_commission).toBe(commission);
    const dayBucket = report?.buckets.find((b) => b.bookings_completed === 1);
    expect(dayBucket?.bucket_start).toBeTruthy();
    expect(dayBucket?.revenue).toBe(total);
    expect(dayBucket?.platform_commission).toBe(commission);
  });

  it("admin_reports periods: capture counted before refund in later period", async () => {
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    const payRows = await queryRows<{ amount: string }>(
      db,
      `SELECT amount::text AS amount FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    const pay = {
      id: paymobId,
      amount: payRows[0]!.amount,
      payment_method_type: "online",
      method: "paymob",
    };
    const capturedAt = new Date("2026-01-10T10:00:00.000Z");
    const refundAt = new Date("2026-02-10T10:00:00.000Z");
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.payments
         SET status = 'refunded',
             captured_at = $2,
             metadata = jsonb_build_object('refund', jsonb_build_object(
               'recorded_at', $3::timestamptz,
               'amount_refunded', $4::numeric,
               'reference', 'TEST-R'
             ))
         WHERE id = $1`,
        [pay!.id, capturedAt.toISOString(), refundAt.toISOString(), pay!.amount],
      ),
    );
    const bucketKey =
      pay!.payment_method_type === "cash" || pay!.method === "cash"
        ? "cash_collected"
        : pay!.payment_method_type === "manual_transfer" || pay!.method === "instapay"
          ? "instapay_received"
          : "card_received";
    const jan = await asUser(db, IDS.adminUser, () =>
      queryRows<{ report: { totals: Record<string, number> } }>(
        db,
        `SELECT public.admin_reports($1::timestamptz, $2::timestamptz, 'month') AS report`,
        ["2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"],
      ),
    );
    const feb = await asUser(db, IDS.adminUser, () =>
      queryRows<{ report: { totals: Record<string, number> } }>(
        db,
        `SELECT public.admin_reports($1::timestamptz, $2::timestamptz, 'month') AS report`,
        ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
      ),
    );
    expect(jan[0]?.report.totals[bucketKey]).toBe(Number(pay!.amount));
    expect(jan[0]?.report.totals.refunds_total).toBe(0);
    expect(feb[0]?.report.totals.refunds_total).toBe(Number(pay!.amount));
  });

  it.each(paymentSituationFixtures)("$name matches SQL admin_payment_situation", async (fixture) => {
    const [status, methodType, method, proof, bookingStatus, hasLedger] = fixture.sql;
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ situation: string }>(
        db,
        `SELECT public.admin_payment_situation($1, $2, $3, $4, $5, $6) AS situation`,
        [status, methodType, method, proof, bookingStatus, hasLedger],
      ),
    );
    expect(rows[0]?.situation).toBe(fixture.expect);
  });
});