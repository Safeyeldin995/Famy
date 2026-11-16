import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
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

const openDebts = async () =>
  queryRows<{ id: string; amount: string; kind: string }>(
    db,
    "SELECT id, amount::text AS amount, kind FROM public.customer_debts WHERE customer_id = $1 AND status = 'open'",
    [IDS.customer],
  );

const ledgerFor = (bookingId: string) =>
  queryRows<{ kind: string; amount: string }>(
    db,
    "SELECT kind, amount::text AS amount FROM public.provider_ledger_entries WHERE booking_id = $1",
    [bookingId],
  );

/** A booking the customer has not prepaid (cash), with the provider on the way. */
async function cashBookingOnTheWay() {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  await seedPaymentsForBooking(db, bookingId); // cash + card both left pending (nothing paid)
  await setBookingStatusAsSystem(db, bookingId, "on_the_way");
  return bookingId;
}

const cancelAsCustomer = (bookingId: string) =>
  tryAsUser(db, IDS.customer, "SELECT public.cancel_booking($1, $2, NULL)", [
    bookingId,
    customerReason,
  ]);

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await seedLifecycleBooking(db);
  const reasons = await queryRows<{ id: string }>(
    db,
    "SELECT id FROM public.cancellation_reasons WHERE code = 'customer_change_of_plans'",
  );
  customerReason = reasons[0].id;
  await asServiceRole(db, () =>
    db.exec(
      `UPDATE public.settings SET value = '{"fee_mode":"fixed","fee_value":50,"free_cancel_hours":2}'::jsonb
       WHERE key = 'cancellation_policy'`,
    ),
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("customer fee debts", () => {
  let firstBooking: string;

  it("a late cancellation on an unpaid booking becomes a debt that blocks new bookings", async () => {
    firstBooking = await cashBookingOnTheWay();
    expect((await cancelAsCustomer(firstBooking)).error).toBeUndefined();
    const debts = await openDebts();
    expect(debts).toEqual([
      expect.objectContaining({ amount: "50.00", kind: "late_cancellation" }),
    ]);

    await expect(seedLifecycleBooking(db)).rejects.toThrow(/BOOKING_DEBT_OUTSTANDING/);
  });

  it("InstaPay: one transfer waits for review; admin rejection keeps the debt, approval settles it", async () => {
    const first = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_submit_debt_instapay('IP-1234')",
    );
    expect(first.error).toBeUndefined();
    const again = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_submit_debt_instapay('IP-9999')",
    );
    expect(again.ok).toBe(false);

    const sid = String(Object.values(first.rows![0])[0]);
    const reject = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_review_debt_settlement($1, false, 'Transfer not found')",
      [sid],
    );
    expect(reject.error).toBeUndefined();
    expect(await openDebts()).toHaveLength(1);

    const second = await tryAsUser(
      db,
      IDS.customer,
      "SELECT public.customer_submit_debt_instapay('IP-5678')",
    );
    const sid2 = String(Object.values(second.rows![0])[0]);
    // Only an admin can confirm.
    expect(
      (
        await tryAsUser(db, IDS.customer, "SELECT public.admin_review_debt_settlement($1, true)", [
          sid2,
        ])
      ).ok,
    ).toBe(false);
    const approve = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_review_debt_settlement($1, true)",
      [sid2],
    );
    expect(approve.error).toBeUndefined();
    expect(await openDebts()).toHaveLength(0);
    expect(await ledgerFor(firstBooking)).toEqual([
      { kind: "cancellation_fee_provider_share", amount: "50.00" },
    ]);

    // Booking works again.
    const { bookingId } = await seedLifecycleBooking(db);
    expect(bookingId).toBeTruthy();
  });

  it("card: the verified Paymob webhook settles the debt and credits the provider", async () => {
    const b = await cashBookingOnTheWay();
    expect((await cancelAsCustomer(b)).error).toBeUndefined();
    expect(await openDebts()).toHaveLength(1);

    const sid = await asServiceRole(db, async () => {
      const rows = await queryRows<{ id: string }>(
        db,
        "SELECT public.open_debt_settlement_for($1, 'card') AS id",
        [IDS.customer],
      );
      await db.query("SELECT public.debt_settlement_attach_paymob($1, $2, 424242, 77)", [
        rows[0].id,
        IDS.customer,
      ]);
      return rows[0].id;
    });

    // Wrong amount is refused.
    await expect(
      asServiceRole(db, () =>
        db.query(
          "SELECT public.paymob_apply_transaction_webhook(9001, 424242, 77, 'EGP', true, false, 4000, '9001')",
        ),
      ),
    ).rejects.toThrow(/does not match settlement/);

    const res = await asServiceRole(db, () =>
      queryRows<{ r: { status: string } }>(
        db,
        "SELECT public.paymob_apply_transaction_webhook(9002, 424242, 77, 'EGP', true, false, 5000, '9002') AS r",
      ),
    );
    expect(res[0].r.status).toBe("paid");
    expect(await openDebts()).toHaveLength(0);
    expect(await ledgerFor(b)).toEqual([
      { kind: "cancellation_fee_provider_share", amount: "50.00" },
    ]);
    const s = await queryRows<{ status: string }>(
      db,
      "SELECT status FROM public.customer_debt_settlements WHERE id = $1",
      [sid],
    );
    expect(s[0].status).toBe("paid");
  });

  it("no debt when the fee comes out of a prepayment; admin can waive a debt", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    const { paymobId } = await seedPaymentsForBooking(db, bookingId);
    await asServiceRole(db, () =>
      db.exec(`
        SELECT set_config('app.ledger_internal_capture', 'on', true);
        UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
      `),
    );
    await setBookingStatusAsSystem(db, bookingId, "on_the_way");
    expect((await cancelAsCustomer(bookingId)).error).toBeUndefined();
    expect(await openDebts()).toHaveLength(0);

    const c = await cashBookingOnTheWay();
    await cancelAsCustomer(c);
    const [debt] = await openDebts();
    expect(
      (
        await tryAsUser(
          db,
          IDS.adminUser,
          "SELECT public.admin_waive_customer_debt($1, 'Goodwill')",
          [debt.id],
        )
      ).error,
    ).toBeUndefined();
    expect(await openDebts()).toHaveLength(0);
    expect(await ledgerFor(c)).toEqual([]);
  });

  it("customers see only their own debts", async () => {
    const other = await tryAsUser(
      db,
      IDS.otherProviderUser,
      "SELECT id FROM public.customer_debts",
    );
    expect(other.rows).toEqual([]);
    const mine = await tryAsUser(db, IDS.customer, "SELECT id FROM public.customer_debts");
    expect(mine.rows!.length).toBeGreaterThan(0);
  });
});
