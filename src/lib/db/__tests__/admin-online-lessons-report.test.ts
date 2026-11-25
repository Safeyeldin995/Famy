import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
  LIFECYCLE_SLOT_END,
  LIFECYCLE_SLOT_START,
  lifecycleBookingBaseDate,
  tryAsUser,
} from "./booking-lifecycle.harness";
import { cairoDatePlusDays } from "./cairo-stable-booking-date";
let db: PGlite;
let templateBookingId: string;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  const seeded = await seedLifecycleBooking(db, { status: "pending" });
  templateBookingId = seeded.bookingId;
}, 180_000);

afterAll(async () => db?.close());

describe("admin_online_lessons_report", () => {
  it("rejects non-admin callers", async () => {
    const err = await asUser(db, IDS.customer, () =>
      db.query(`SELECT public.admin_online_lessons_report($1::timestamptz, $2::timestamptz)`, [
        "2020-01-01T00:00:00.000Z",
        "2030-01-01T00:00:00.000Z",
      ]),
    ).catch((e) => e);
    expect(String(err)).toMatch(/Admin required/i);
  });

  it("returns an empty report for an isolated future window", async () => {
    const from = "2099-01-01T00:00:00.000Z";
    const to = "2099-01-02T00:00:00.000Z";
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ report: { funnel: { request: number }; export_rows: unknown[] } }>(
        db,
        `SELECT public.admin_online_lessons_report($1::timestamptz, $2::timestamptz) AS report`,
        [from, to],
      ),
    );
    expect(rows[0]?.report.funnel.request).toBe(0);
    expect((rows[0]?.report as { has_activity?: boolean }).has_activity).toBe(false);
    expect(rows[0]?.report.export_rows).toEqual([]);
  });

  it("scopes metrics to online service_mode only", async () => {
    const isolatedAt = "2026-06-10T12:00:00.000Z";
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings
         SET created_at = $1::timestamptz,
             start_at = $1::timestamptz,
             end_at = $1::timestamptz + interval '2 hours',
             completed_at = $1::timestamptz
         WHERE id = $2`,
        [isolatedAt, templateBookingId],
      ),
    );

    const from = "2026-06-10T00:00:00.000Z";
    const to = "2026-06-11T00:00:00.000Z";
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{
        report: { funnel: { request: number }; kpis: { totals: { completed: number } } };
      }>(
        db,
        `SELECT public.admin_online_lessons_report($1::timestamptz, $2::timestamptz) AS report`,
        [from, to],
      ),
    );
    expect(rows[0]?.report.funnel.request).toBe(0);
    expect(rows[0]?.report.kpis.totals.completed).toBe(0);
  });

  it("wallet_credit_used nets checkout releases against spends (100 spend, release, recapture)", async () => {
    const teenMemberId = "00000000-0000-0000-0000-000000000612";
    const slotDate = cairoDatePlusDays(lifecycleBookingBaseDate(), 14);
    const startAt = `${slotDate}T${LIFECYCLE_SLOT_START}:00+02:00`;
    const endAt = `${slotDate}T${LIFECYCLE_SLOT_END}:00+02:00`;

    const serviceRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.services WHERE slug = 'school-subject-tutoring' LIMIT 1`,
    );
    const serviceId = serviceRows[0]?.id;
    if (!serviceId) throw new Error("school-subject-tutoring service missing");

    const taxonomy = await queryRows<{
      subject_id: string;
      curriculum_id: string;
      level_id: string;
      subject_code: string;
      curriculum_code: string;
      level_code: string;
    }>(
      db,
      `SELECT ts.id AS subject_id, tc.id AS curriculum_id, tl.id AS level_id,
              ts.code AS subject_code, tc.code AS curriculum_code, tl.code AS level_code
       FROM public.teaching_subjects ts
       JOIN public.teaching_subject_services tss
         ON tss.subject_id = ts.id AND tss.service_id = $1
       CROSS JOIN public.teaching_curricula tc
       CROSS JOIN public.teaching_levels tl
       LIMIT 1`,
      [serviceId],
    );
    const tax = taxonomy[0];
    if (!tax) throw new Error("tutoring taxonomy missing");

    await asServiceRole(db, async () => {
      await db.query(
        `INSERT INTO public.family_members (
           id, customer_id, full_name, relationship, date_of_birth, is_active
         ) VALUES ($1, $2, 'Teen Learner', 'son', DATE '2010-06-01', true)
         ON CONFLICT (id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth`,
        [teenMemberId, IDS.customer],
      );
      await db.query(
        `UPDATE public.providers
         SET offering_mode = 'both', is_verified = true
         WHERE id = $1`,
        [IDS.provider],
      );
      await db.query(
        `INSERT INTO public.provider_teaching_capabilities (
           provider_id, service_id, subject_id, curriculum_id, level_id,
           session_duration_min, session_price, status
         ) VALUES ($1, $2, $3, $4, $5, 120, 400, 'approved')
         ON CONFLICT (provider_id, service_id, subject_id, curriculum_id, level_id)
         DO UPDATE SET status = 'approved'`,
        [IDS.provider, serviceId, tax.subject_id, tax.curriculum_id, tax.level_id],
      );
      await db.query(`SELECT set_config('app.provider_service_request', '1', true)`);
      await db.query(
        `INSERT INTO public.provider_services (provider_id, service_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (provider_id, service_id) DO UPDATE SET status = EXCLUDED.status`,
        [IDS.provider, serviceId],
      );
    });

    const psRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_services
       WHERE provider_id = $1 AND service_id = $2 LIMIT 1`,
      [IDS.provider, serviceId],
    );
    const psId = psRows[0]?.id;
    if (!psId) throw new Error("provider service row missing");

    await asUser(db, IDS.adminUser, () =>
      db.query(`SELECT public.admin_set_provider_service_status($1, 'approved', NULL)`, [psId]),
    );

    const capRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.provider_teaching_capabilities
       WHERE provider_id = $1 AND service_id = $2 AND status = 'approved'
       LIMIT 1`,
      [IDS.provider, serviceId],
    );
    const capabilityId = capRows[0]?.id;
    if (!capabilityId) throw new Error("teaching capability missing");

    const created = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.create_booking(
         $1::uuid, $2::uuid, NULL,
         $3::timestamptz, $4::timestamptz, $5::uuid,
         $6::uuid, NULL, NULL, '[]'::jsonb,
         $7::uuid, $8, $9, $10, NULL, 'online'
       ) AS result`,
      [
        IDS.provider,
        serviceId,
        startAt,
        endAt,
        randomUUID(),
        teenMemberId,
        capabilityId,
        tax.subject_code,
        tax.curriculum_code,
        tax.level_code,
      ],
    );
    expect(created.error).toBeUndefined();
    const bookingId = (created.rows?.[0]?.result as { booking_id?: string })?.booking_id;
    if (!bookingId) throw new Error("online booking seed failed");

    await asServiceRole(db, () =>
      db.query(`UPDATE public.bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]),
    );

    const paymobRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.payment_methods WHERE code = 'paymob' LIMIT 1`,
    );
    const paymobMethodId = paymobRows[0]?.id;
    if (!paymobMethodId) throw new Error("paymob method missing");
    const paymobId = randomUUID();
    const dueRows = await queryRows<{ due: string }>(
      db,
      `SELECT (price_total + COALESCE(carried_fees_amount, 0))::text AS due
       FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    await asServiceRole(db, async () => {
      await db.query(`UPDATE public.payment_methods SET is_active = true WHERE code = 'paymob'`);
      await db.query(
        `INSERT INTO public.payments (
           id, booking_id, customer_id, amount, status, payment_method_id, metadata
         ) VALUES ($1, $2, $3, $4::numeric, 'pending', $5, '{}'::jsonb)`,
        [paymobId, bookingId, IDS.customer, dueRows[0]?.due ?? "200", paymobMethodId],
      );
    });
    const eventAt = "2027-03-10T14:00:00.000Z";
    const from = "2027-03-10T00:00:00.000Z";
    const to = "2027-03-11T00:00:00.000Z";

    await asServiceRole(db, async () => {
      await tryAsUser(
        db,
        IDS.adminUser,
        "SELECT public.admin_adjust_customer_wallet($1, 'credit', 150, 'wallet report test', NULL)",
        [IDS.customer],
      );

      await db.query(
        `SELECT public.customer_wallet_insert_entry(
           $1, 'debit', 100, 'checkout_spend', $2, $3, NULL,
           $4, '{}'::jsonb
         )`,
        [IDS.customer, bookingId, paymobId, `checkout_spend:${paymobId}`],
      );
      await db.query(
        `UPDATE public.customer_wallet_entries SET created_at = $1::timestamptz
         WHERE idempotency_key = $2`,
        [eventAt, `checkout_spend:${paymobId}`],
      );

      await db.query(
        `SELECT public.customer_wallet_insert_entry(
           $1, 'credit', 100, 'checkout_release', $2, $3, NULL,
           $4, '{}'::jsonb
         )`,
        [IDS.customer, bookingId, paymobId, `checkout_release:${paymobId}`],
      );
      await db.query(
        `UPDATE public.customer_wallet_entries SET created_at = $1::timestamptz
         WHERE idempotency_key = $2`,
        [eventAt, `checkout_release:${paymobId}`],
      );

      await db.query(
        `SELECT public.customer_wallet_insert_entry(
           $1, 'debit', 100, 'checkout_spend', $2, $3, NULL,
           $4, '{}'::jsonb
         )`,
        [IDS.customer, bookingId, paymobId, `checkout_spend_recapture:${paymobId}`],
      );
      await db.query(
        `UPDATE public.customer_wallet_entries SET created_at = $1::timestamptz
         WHERE idempotency_key = $2`,
        [eventAt, `checkout_spend_recapture:${paymobId}`],
      );
    });

    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ report: { kpis: { totals: { wallet_credit_used: number } } } }>(
        db,
        `SELECT public.admin_online_lessons_report($1::timestamptz, $2::timestamptz) AS report`,
        [from, to],
      ),
    );
    expect(Number(rows[0]?.report.kpis.totals.wallet_credit_used)).toBe(100);
  });
});
