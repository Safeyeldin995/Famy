import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asServiceRole,
  asUser,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
} from "./booking-lifecycle.harness";
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
});
