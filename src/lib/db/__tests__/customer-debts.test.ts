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

/** A receipt file the customer uploaded (storage is a stub in the migration replay). */
const putReceipt = (path: string) =>
  db.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('payment-proofs', $1)", [path]);
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
  for (const r of ["r1", "r2", "r3", "r4"]) await putReceipt(`fees/${IDS.customer}/${r}.jpg`);
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

  it("a late cancellation on an unpaid booking becomes a debt that rides on the next booking", async () => {
    firstBooking = await cashBookingOnTheWay();
    expect((await cancelAsCustomer(firstBooking)).error).toBeUndefined();
    const debts = await openDebts();
    expect(debts).toEqual([
      expect.objectContaining({ amount: "50.00", kind: "late_cancellation" }),
    ]);

    // Booking is allowed; the fee is added to it.
    const { bookingId: next } = await seedLifecycleBooking(db);
    const carried = await queryRows<{ c: string }>(
      db,
      "SELECT carried_fees_amount::text AS c FROM public.bookings WHERE id = $1",
      [next],
    );
    expect(carried[0].c).toBe("50.00");
    expect(
      (await tryAsUser(db, IDS.customer, "SELECT * FROM public.my_unpaid_fees()")).rows,
    ).toEqual([]);

    // That booking is cancelled before anything was paid: the fee is free again.
    await setBookingStatusAsSystem(db, next, "cancelled");
    const mine = await tryAsUser(
      db,
      IDS.customer,
      "SELECT amount::text AS a FROM public.my_unpaid_fees()",
    );
    expect(mine.rows).toEqual([{ a: "50.00" }]);
  });

  it("InstaPay: one receipt waits for review; admin rejection keeps the debt, approval settles it", async () => {
    // A receipt outside the customer's own folder is refused.
    const foreign = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.otherProviderUser}/x.jpg')`,
    );
    expect(foreign.ok).toBe(false);
    // So is a receipt that was never uploaded.
    const missing = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/nothing.jpg')`,
    );
    expect(missing.ok).toBe(false);
    const first = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/r1.jpg')`,
    );
    expect(first.error).toBeUndefined();
    const again = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/r2.jpg')`,
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
    // The rejected receipt can't be sent again.
    const reused = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/r1.jpg')`,
    );
    expect(reused.ok).toBe(false);

    const second = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/r3.jpg')`,
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

  it("a second successful card payment after the debt was settled is flagged for refund", async () => {
    const b = await cashBookingOnTheWay();
    await cancelAsCustomer(b);
    const first = await asServiceRole(db, async () => {
      const rows = await queryRows<{ id: string }>(
        db,
        "SELECT public.open_debt_settlement_for($1, 'card') AS id",
        [IDS.customer],
      );
      await db.query("SELECT public.debt_settlement_attach_paymob($1, $2, 515151, 77)", [
        rows[0].id,
        IDS.customer,
      ]);
      return rows[0].id;
    });
    // Customer gives up on the card and pays by InstaPay; admin confirms.
    const ip = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.customer_submit_debt_instapay('fees/${IDS.customer}/r4.jpg')`,
    );
    const ipId = String(Object.values(ip.rows![0])[0]);
    await tryAsUser(db, IDS.adminUser, "SELECT public.admin_review_debt_settlement($1, true)", [
      ipId,
    ]);
    // The abandoned card payment still completes.
    await asServiceRole(db, () =>
      db.query(
        "SELECT public.paymob_apply_transaction_webhook(9101, 515151, 77, 'EGP', true, false, 5000, '9101')",
      ),
    );
    const rows = await queryRows<{ status: string; needs_refund: boolean; r: string }>(
      db,
      "SELECT status, needs_refund, refund_amount::text AS r FROM public.customer_debt_settlements WHERE id = $1",
      [first],
    );
    expect(rows[0]).toEqual({ status: "paid", needs_refund: true, r: "50.00" });
    // The provider is credited once.
    expect(await ledgerFor(b)).toEqual([
      { kind: "cancellation_fee_provider_share", amount: "50.00" },
    ]);
    const done = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_record_debt_overpayment_refund($1, 'IP-BACK-1')",
      [first],
    );
    expect(done.error).toBeUndefined();
  });

  it("a rejected no-show report cancels the customer's fee", async () => {
    const b = await cashBookingOnTheWay();
    const report = await tryAsUser(
      db,
      IDS.providerUser,
      "SELECT public.report_no_show($1, 'Nobody answered', '{}') AS id",
      [b],
    );
    expect(report.error).toBeUndefined();
    expect(await openDebts()).toEqual([expect.objectContaining({ kind: "no_show" })]);
    const reportId = String(report.rows![0].id);
    const resolve = await tryAsUser(
      db,
      IDS.adminUser,
      "SELECT public.admin_resolve_no_show($1, 'rejected', 'Customer was home', 'completed')",
      [reportId],
    );
    expect(resolve.error).toBeUndefined();
    expect(await openDebts()).toHaveLength(0);
  });

  it("an account with unpaid fees cannot be deleted", async () => {
    const b = await cashBookingOnTheWay();
    await cancelAsCustomer(b);
    const check = await tryAsUser(db, IDS.customer, "SELECT public.account_deletion_check() AS c");
    expect((check.rows![0].c as { reason: string }).reason).toBe("unpaid_balance");
    await expect(
      asServiceRole(db, () => db.query("SELECT public.anonymize_account($1)", [IDS.customer])),
    ).rejects.toThrow(/account_deletion_blocked/);
    const [debt] = await openDebts();
    await tryAsUser(db, IDS.adminUser, "SELECT public.admin_waive_customer_debt($1, 'Test')", [
      debt.id,
    ]);
    const after = await tryAsUser(db, IDS.customer, "SELECT public.account_deletion_check() AS c");
    expect((after.rows![0].c as { reason?: string }).reason).not.toBe("unpaid_balance");
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
