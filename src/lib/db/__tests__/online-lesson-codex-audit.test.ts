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

  it("blocks direct INSERT into online_lesson_issue_reports", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const insert = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.online_lesson_issue_reports (
         booking_id, reported_by, reporter_role, category, description, status, priority
       ) VALUES ($1, $2, 'customer', 'behavior', 'Malicious direct insert attempt.', 'open', 'normal')`,
      [bookingId, IDS.customer],
    );
    expect(insert.ok).toBe(false);
  });

  it("hides admin_notes from participants via column privileges", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "completed" });
    const reportId = (
      await asServiceRole(db, () =>
        queryRows<{ id: string }>(
          db,
          `INSERT INTO public.online_lesson_issue_reports (
             booking_id, reported_by, reporter_role, category, description, admin_notes
           ) VALUES ($1, $2, 'customer', 'connection',
             'Connection kept dropping during the scheduled online lesson.',
             'internal-only evidence')
           RETURNING id`,
          [bookingId, IDS.customer],
        ),
      )
    )[0]?.id;
    if (!reportId) throw new Error("expected report row");

    const tableLeak = await tryAsUser(
      db,
      IDS.customer,
      "SELECT admin_notes FROM public.online_lesson_issue_reports WHERE id = $1",
      [reportId],
    );
    if (tableLeak.ok) expect(tableLeak.rows?.length ?? 0).toBe(0);
    else expect(tableLeak.error).toBeDefined();

    const tableRead = await tryAsUser(
      db,
      IDS.customer,
      "SELECT id, category, description FROM public.online_lesson_issue_reports WHERE id = $1",
      [reportId],
    );
    expect(tableRead.ok).toBe(true);
    expect(tableRead.rows?.length ?? 0).toBeGreaterThan(0);
    expect(String(tableRead.rows?.[0]?.description ?? "")).toContain("Connection");
  });

  it("final create_booking enforces online age check", async () => {
    const row = await queryRows<{ src: string }>(
      db,
      `SELECT pg_get_functiondef(p.oid) AS src
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'create_booking'
       ORDER BY pg_catalog.pg_get_function_identity_arguments(p.oid) DESC
       LIMIT 1`,
    );
    expect(row[0]?.src).toMatch(/booking_online_age_years/);
  });
});