import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("online lesson — codex audit database", () => {
  it("removes automatic attendance payment outcomes", async () => {
    const row = await queryRows<{ f: string | null }>(
      db,
      `SELECT to_regprocedure(
        'apply_online_session_payment_outcome(public.bookings,text,numeric,boolean)'
      )::text AS f`,
    );
    expect(row[0]?.f).toBeNull();
  });

  it("exposes expire_unpaid_confirmed_bookings for scheduler use", async () => {
    const rows = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.expire_unpaid_confirmed_bookings()::int AS n`),
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(0);
  });

  it("limits lesson issue reports to online bookings", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const report = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.report_online_lesson_issue($1, 'connection', $2) AS id",
      [bookingId, "Connection dropped repeatedly during the scheduled lesson."],
    );
    expect(report.error).toMatch(/Not an online lesson/);
  });
});