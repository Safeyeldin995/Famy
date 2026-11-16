import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  paymentStatus,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  setBookingStatusAsSystem,
  tryAsUser,
} from "./booking-lifecycle.harness";

let db: PGlite;
let bookingId: string;
let paymobId: string;

const refund = (user: string, ref: string) =>
  tryAsUser(db, user, `SELECT public.admin_record_payment_refund('${paymobId}', '${ref}')`);

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  ({ bookingId } = await seedLifecycleBooking(db));
  ({ paymobId } = await seedPaymentsForBooking(db, bookingId));
  // The customer paid by card (stands in for the verified webhook capture).
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymobId}';
    `),
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_record_payment_refund", () => {
  it("refuses while the booking is still active, and refuses non-admins", async () => {
    const active = await refund(IDS.adminUser, "PM-REF-1");
    expect(active.ok).toBe(false);
    expect(active.error).toMatch(/cancelled or no-show/);

    await setBookingStatusAsSystem(db, bookingId, "cancelled");
    const customer = await refund(IDS.customer, "PM-REF-1");
    expect(customer.ok).toBe(false);
    expect(customer.error).toMatch(/Admin required/);
    expect(await paymentStatus(db, paymobId)).toBe("captured");
  });

  it("requires a reference, then records the refund once", async () => {
    const empty = await refund(IDS.adminUser, " ");
    expect(empty.ok).toBe(false);

    const ok = await refund(IDS.adminUser, "PM-REF-1");
    expect(ok.error).toBeUndefined();
    expect(await paymentStatus(db, paymobId)).toBe("refunded");
    const meta = await queryRows<{ ref: string; prev: string }>(
      db,
      `SELECT metadata->'refund'->>'reference' AS ref, metadata->'refund'->>'previous_status' AS prev
       FROM public.payments WHERE id = $1`,
      [paymobId],
    );
    expect(meta[0]).toEqual({ ref: "PM-REF-1", prev: "captured" });

    const again = await refund(IDS.adminUser, "PM-REF-2");
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/no money to refund/);
  });

  it("refunds an InstaPay transfer only when the customer uploaded a receipt", async () => {
    const methods = await queryRows<{ id: string }>(
      db,
      "SELECT id FROM public.payment_methods WHERE code = 'instapay'",
    );
    const addTransfer = async (proof: string | null) => {
      const { bookingId: b } = await seedLifecycleBooking(db);
      const rows = await asServiceRole(db, () =>
        queryRows<{ id: string }>(
          db,
          `INSERT INTO public.payments (booking_id, customer_id, amount, status, payment_method_id, metadata)
           SELECT $1, $2, b.price_total, 'pending_review', $3, '{}'::jsonb
           FROM public.bookings b WHERE b.id = $1 RETURNING id`,
          [b, IDS.customer, methods[0].id],
        ),
      );
      if (proof)
        await asServiceRole(db, () =>
          db.query("UPDATE public.payments SET proof_path = $1 WHERE id = $2", [
            `${b}/receipt.jpg`,
            rows[0].id,
          ]),
        );
      await setBookingStatusAsSystem(db, b, "cancelled");
      return rows[0].id;
    };
    const call = (id: string) =>
      tryAsUser(db, IDS.adminUser, `SELECT public.admin_record_payment_refund('${id}', 'IP-77')`);

    const withReceipt = await addTransfer("yes");
    expect((await call(withReceipt)).error).toBeUndefined();
    expect(await paymentStatus(db, withReceipt)).toBe("refunded");

    const noReceipt = await addTransfer(null);
    const refused = await call(noReceipt);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/no money to refund/);
    expect(await paymentStatus(db, noReceipt)).toBe("pending_review");
  });

  it("is not callable by anonymous users", async () => {
    const rows = await queryRows<{ allowed: boolean }>(
      db,
      `SELECT has_function_privilege('anon', 'public.admin_record_payment_refund(uuid, text)', 'EXECUTE') AS allowed`,
    );
    expect(rows[0].allowed).toBe(false);
  });
});
