import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  asUser,
  completeHappyPath,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
} from "./booking-lifecycle.harness";

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
  it("provider statement closing matches ledger net as of period end", async () => {
    const from = "2020-01-01T00:00:00.000Z";
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ statement: Record<string, unknown> }>(
        db,
        `SELECT public.admin_provider_statement($1::uuid, $2::timestamptz, $3::timestamptz) AS statement`,
        [IDS.provider, from, to],
      ),
    );
    const statement = rows[0]?.statement;
    expect(statement).toBeTruthy();
    const check = statement?.balance_check as { ledger_balance_as_of?: number } | undefined;
    expect(statement?.closing_balance).toBe(check?.ledger_balance_as_of);
  });

  it("admin_reports totals include at least one completed booking", async () => {
    const from = "2020-01-01T00:00:00.000Z";
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ report: { totals: { bookings_completed: number } } }>(
        db,
        `SELECT public.admin_reports($1::timestamptz, $2::timestamptz, 'month') AS report`,
        [from, to],
      ),
    );
    expect((rows[0]?.report.totals.bookings_completed ?? 0) >= 1).toBe(true);
  });

  it("admin_payment_situation matches refundDue on cancelled captured online", async () => {
    const rows = await asUser(db, IDS.adminUser, () =>
      queryRows<{ situation: string }>(
        db,
        `SELECT public.admin_payment_situation('captured', 'online', 'paymob', NULL, 'cancelled', false) AS situation`,
      ),
    );
    expect(rows[0]?.situation).toBe("refundDue");
  });
});