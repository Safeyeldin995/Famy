import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  bookingStatus,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  setBookingStatusAsSystem,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;
let customerReason: string;
let providerReason: string;

const setPolicy = (mode: "fixed" | "percent", value: number, hours = 2) =>
  asServiceRole(db, () =>
    db.query("UPDATE public.settings SET value = $1::jsonb WHERE key = 'cancellation_policy'", [
      JSON.stringify({ fee_mode: mode, fee_value: value, free_cancel_hours: hours }),
    ]),
  );

const fee = async (bookingId: string, user: string = IDS.customer) => {
  const r = await tryAsUser(db, user, `SELECT public.booking_cancellation_fee($1) AS fee`, [
    bookingId,
  ]);
  if (!r.ok) throw new Error(r.error);
  return Number(r.rows?.[0]?.fee);
};

const cancel = (user: string, bookingId: string, reasonId: string) =>
  tryAsUser(db, user, `SELECT public.cancel_booking($1, $2, NULL)`, [bookingId, reasonId]);

async function paidBooking(status: "confirmed" | "on_the_way") {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
    `),
  );
  if (status === "on_the_way") await setBookingStatusAsSystem(db, bookingId, "on_the_way");
  const total = await queryRows<{ t: string }>(
    db,
    "SELECT price_total::text AS t FROM public.bookings WHERE id = $1",
    [bookingId],
  );
  return { bookingId, paymobId, total: Number(total[0].t) };
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
  const reasons = await queryRows<{ code: string; id: string }>(
    db,
    "SELECT code, id FROM public.cancellation_reasons WHERE code IN ('customer_change_of_plans', 'provider_emergency')",
  );
  customerReason = reasons.find((r) => r.code === "customer_change_of_plans")!.id;
  providerReason = reasons.find((r) => r.code === "provider_emergency")!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("cancellation fee policy", () => {
  it("defaults to no fee", async () => {
    const { bookingId } = await paidBooking("on_the_way");
    expect(await fee(bookingId)).toBe(0);
  });

  it("is free well before the visit, charged inside the window (fixed amount)", async () => {
    await setPolicy("fixed", 50, 2);
    const { bookingId } = await paidBooking("confirmed");
    await asServiceRole(db, () =>
      db.exec(`UPDATE public.bookings SET start_at = now() + interval '2 days',
               end_at = now() + interval '2 days 2 hours' WHERE id = '${bookingId}'`),
    );
    // The visit is two days away: outside a 2-hour window.
    expect(await fee(bookingId)).toBe(0);
    await setPolicy("fixed", 50, 24 * 365);
    expect(await fee(bookingId)).toBe(50);
  });

  it("charges a percentage of the booking once the provider set off, and caps at the total", async () => {
    await setPolicy("percent", 10, 2);
    const { bookingId, total } = await paidBooking("on_the_way");
    expect(await fee(bookingId)).toBeCloseTo(Math.round(total * 10) / 100, 2);
    await setPolicy("fixed", total + 500, 2);
    expect(await fee(bookingId)).toBe(total);
  });

  it("lets the customer cancel after the provider set off, records the fee, and refunds the rest", async () => {
    await setPolicy("fixed", 50, 2);
    const { bookingId, paymobId, total } = await paidBooking("on_the_way");

    // The provider cannot cancel once on the way.
    expect((await cancel(IDS.providerUser, bookingId, providerReason)).ok).toBe(false);

    const res = await cancel(IDS.customer, bookingId, customerReason);
    expect(res.error).toBeUndefined();
    expect(await bookingStatus(db, bookingId)).toBe("cancelled");
    const rec = await queryRows<{ fee: string }>(
      db,
      "SELECT cancellation_fee::text AS fee FROM public.booking_cancellations WHERE booking_id = $1",
      [bookingId],
    );
    expect(Number(rec[0].fee)).toBe(50);

    // A later policy change does not change what was charged.
    await setPolicy("fixed", 999, 2);
    expect(await fee(bookingId)).toBe(50);

    const refund = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_record_payment_refund('${paymobId}', 'PM-R-9')`,
    );
    expect(refund.error).toBeUndefined();
    const pay = await queryRows<{ status: string; refunded: string; fee: string }>(
      db,
      `SELECT status::text AS status, metadata->'refund'->>'amount_refunded' AS refunded,
              metadata->'refund'->>'cancellation_fee' AS fee
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(pay[0].status).toBe("partially_refunded");
    expect(Number(pay[0].refunded)).toBe(total - 50);
    expect(Number(pay[0].fee)).toBe(50);

    const ledger = await queryRows<{ kind: string; direction: string; amount: string }>(
      db,
      "SELECT kind, direction, amount::text AS amount FROM public.provider_ledger_entries WHERE booking_id = $1",
      [bookingId],
    );
    expect(ledger).toEqual([
      { kind: "cancellation_fee_provider_share", direction: "credit", amount: "50.00" },
    ]);
  });

  it("charges nothing when the provider cancels or the provider didn't show up", async () => {
    await setPolicy("fixed", 50, 24 * 365);
    const a = await paidBooking("confirmed");
    expect((await cancel(IDS.providerUser, a.bookingId, providerReason)).error).toBeUndefined();
    expect(await fee(a.bookingId)).toBe(0);

    const b = await paidBooking("on_the_way");
    await asServiceRole(db, () =>
      db.exec(
        `UPDATE public.bookings SET status = 'no_show', no_show_party = 'provider' WHERE id = '${b.bookingId}'`,
      ),
    );
    expect(await fee(b.bookingId)).toBe(0);

    const c = await paidBooking("on_the_way");
    await asServiceRole(db, () =>
      db.exec(
        `UPDATE public.bookings SET status = 'no_show', no_show_party = 'customer' WHERE id = '${c.bookingId}'`,
      ),
    );
    expect(await fee(c.bookingId)).toBe(50);
  });

  it("saves the no-show fee when the provider reports it, so later policy edits don't change it", async () => {
    await setPolicy("fixed", 40, 2);
    const { bookingId } = await paidBooking("on_the_way");
    const report = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.report_no_show($1, 'Nobody answered the door', '{}')",
      [bookingId],
    );
    expect(report.error).toBeUndefined();
    await setPolicy("fixed", 300, 2);
    expect(await fee(bookingId)).toBe(40);
  });

  it("hides the fee from unrelated users", async () => {
    const { bookingId } = await paidBooking("confirmed");
    const r = await tryAsUser(
      db,
      IDS.otherProviderUser,
      "SELECT public.booking_cancellation_fee($1)",
      [bookingId],
    );
    expect(r.ok).toBe(false);
  });
});
