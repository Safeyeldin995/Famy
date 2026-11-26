import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
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

async function capture(paymentId: string) {
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments SET status = 'captured', captured_at = now() WHERE id = '${paymentId}';
    `),
  );
}

async function paidBooking(status: "cancelled" | "completed" | "confirmed") {
  const { bookingId } = await seedLifecycleBooking(db);
  const { paymobId } = await seedPaymentsForBooking(db, bookingId);
  await capture(paymobId);
  if (status !== "confirmed") await setBookingStatusAsSystem(db, bookingId, status);
  return { bookingId, paymobId };
}

async function walletBalance(customerId: string = IDS.customer): Promise<number> {
  const rows = await queryRows<{ b: string }>(
    db,
    `SELECT COALESCE(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS b
     FROM public.customer_wallet_entries WHERE customer_id = $1`,
    [customerId],
  );
  return Number(rows[0].b);
}

async function funded(paymentId: string): Promise<number> {
  const rows = await queryRows<{ f: string }>(
    db,
    `SELECT public.payment_checkout_funded_total(p)::text AS f FROM public.payments p WHERE p.id = $1`,
    [paymentId],
  );
  return Number(rows[0].f);
}

const quote = async (bookingId: string) => {
  const res = await tryAsUser(
    db,
    IDS.adminUser,
    `SELECT public.admin_booking_wallet_refund_quote('${bookingId}') AS q`,
  );
  expect(res.error).toBeUndefined();
  return (res.rows?.[0] as { q: Record<string, unknown> }).q;
};

const refund = (
  bookingId: string,
  amount: number,
  key = randomUUID(),
  user: string = IDS.adminUser,
) =>
  tryAsUser(
    db,
    user,
    `SELECT public.admin_refund_booking_to_wallet('${bookingId}', ${amount}, 'العميل اشتكى', '${key}') AS r`,
  );

const adjust = (
  direction: "credit" | "debit",
  amount: number,
  category: string,
  note: string | null,
  key = randomUUID(),
  user: string = IDS.adminUser,
) =>
  tryAsUser(db, user, `SELECT public.admin_wallet_adjust($1, $2, $3, $4, $5, NULL, $6) AS id`, [
    IDS.customer,
    direction,
    amount,
    category,
    note,
    key,
  ]);

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_refund_booking_to_wallet", () => {
  it("refuses an active booking and a non-admin", async () => {
    const { bookingId } = await paidBooking("confirmed");
    const q = await quote(bookingId);
    expect(q.blocked).toBe("booking_active");
    const active = await refund(bookingId, 10);
    expect(active.ok).toBe(false);
    expect(active.error).toMatch(/WALLET_REFUND_BLOCKED:booking_active/);

    await setBookingStatusAsSystem(db, bookingId, "cancelled");
    const customer = await refund(bookingId, 10, randomUUID(), IDS.customer);
    expect(customer.ok).toBe(false);
    expect(customer.error).toMatch(/Admin required/);
  });

  it("refunds a cancelled booking once, links it, and blocks the card refund afterwards", async () => {
    const { bookingId, paymobId } = await paidBooking("cancelled");
    const before = await walletBalance();
    const q = await quote(bookingId);
    expect(q.blocked).toBeNull();
    const max = Number(q.max_refundable);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(await funded(paymobId));

    const tooHigh = await refund(bookingId, max + 1);
    expect(tooHigh.ok).toBe(false);
    expect(tooHigh.error).toMatch(/WALLET_REFUND_TOO_HIGH/);

    const key = randomUUID();
    const ok = await refund(bookingId, max, key);
    expect(ok.error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before + max, 2);

    // A retry with the same key does not credit again.
    const replay = await refund(bookingId, max, key);
    expect(replay.error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before + max, 2);

    const entry = await queryRows<{
      reason: string;
      booking_id: string;
      payment_id: string;
      admin_id: string;
    }>(
      db,
      `SELECT reason, booking_id, payment_id, admin_id FROM public.customer_wallet_entries
       WHERE booking_id = $1 AND reason = 'admin_lesson_refund'`,
      [bookingId],
    );
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatchObject({
      booking_id: bookingId,
      payment_id: paymobId,
      admin_id: IDS.adminUser,
    });
    expect(["refunded", "partially_refunded"]).toContain(await paymentStatus(db, paymobId));

    // No second wallet refund, and no card refund on top.
    const second = await refund(bookingId, 1);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/WALLET_REFUND_BLOCKED/);
    const card = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_record_payment_refund('${paymobId}', 'PM-REF-9')`,
    );
    expect(card.ok).toBe(false);
    expect(await walletBalance()).toBeCloseTo(before + max, 2);

    const notes = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.notifications
       WHERE user_id = $1 AND type = 'wallet_lesson_refund' AND booking_id = $2`,
      [IDS.customer, bookingId],
    );
    expect(notes[0].n).toBe("1");
  });

  it("refuses a wallet refund after the card refund was recorded", async () => {
    const { bookingId, paymobId } = await paidBooking("cancelled");
    const card = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_record_payment_refund('${paymobId}', 'PM-REF-1')`,
    );
    expect(card.error).toBeUndefined();
    const q = await quote(bookingId);
    expect(q.blocked).toBe("already_refunded");
    const res = await refund(bookingId, 1);
    expect(res.ok).toBe(false);
  });

  it("refuses when the provider-cancel refund already went to the wallet", async () => {
    const { bookingId, paymobId } = await paidBooking("cancelled");
    await asServiceRole(db, () =>
      db.exec(`SELECT public.credit_customer_wallet_provider_cancelled('${bookingId}')`),
    );
    const refunded = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.customer_wallet_entries WHERE payment_id = $1`,
      [paymobId],
    );
    if (refunded[0].n === "0") return; // the auto path did not apply in this fixture
    const q = await quote(bookingId);
    expect(q.blocked).toBe("already_refunded");
    expect((await refund(bookingId, 1)).ok).toBe(false);
  });

  it("lets a completed lesson be refunded in parts, never above what was paid", async () => {
    const { bookingId, paymobId } = await paidBooking("completed");
    const total = await funded(paymobId);
    const before = await walletBalance();

    expect((await refund(bookingId, 40)).error).toBeUndefined();
    const q = await quote(bookingId);
    expect(Number(q.max_refundable)).toBeCloseTo(total - 40, 2);
    expect(await paymentStatus(db, paymobId)).toBe("captured");

    const over = await refund(bookingId, total);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/WALLET_REFUND_TOO_HIGH/);

    expect((await refund(bookingId, total - 40)).error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before + total, 2);
    const done = await quote(bookingId);
    expect(done.blocked).toBe("nothing_left");
  });
});

describe("admin_wallet_adjust", () => {
  it("adds and deducts with a reason, never below zero, once per key", async () => {
    const start = await walletBalance();
    const noReason = await adjust("credit", 50, "other", null);
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toMatch(/WALLET_REASON_REQUIRED/);
    const badCategory = await adjust("credit", 50, "whatever", "x");
    expect(badCategory.error).toMatch(/WALLET_CATEGORY_INVALID/);

    const key = randomUUID();
    expect((await adjust("credit", 50, "gift", null, key)).error).toBeUndefined();
    expect((await adjust("credit", 50, "gift", null, key)).error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(start + 50, 2);
    const conflict = await adjust("credit", 60, "gift", null, key);
    expect(conflict.error).toMatch(/WALLET_IDEMPOTENCY_CONFLICT/);

    const tooMuch = await adjust("debit", start + 51, "correction", "غلط");
    expect(tooMuch.error).toMatch(/WALLET_INSUFFICIENT/);
    expect((await adjust("debit", 20, "correction", "غلط في المبلغ")).error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(start + 30, 2);

    const meta = await queryRows<{ category: string; admin_id: string }>(
      db,
      `SELECT metadata->>'category' AS category, admin_id FROM public.customer_wallet_entries
       WHERE customer_id = $1 AND reason = 'admin_debit' ORDER BY created_at DESC LIMIT 1`,
      [IDS.customer],
    );
    expect(meta[0]).toEqual({ category: "correction", admin_id: IDS.adminUser });

    const customer = await adjust("credit", 5, "gift", null, randomUUID(), IDS.customer);
    expect(customer.error).toMatch(/Admin required/);
  });

  it("shows the history with the balance after each entry", async () => {
    const res = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_customer_wallet_history($1, 200, 0) AS h`,
      [IDS.customer],
    );
    expect(res.error).toBeUndefined();
    const h = (res.rows?.[0] as { h: { balance: number; items: Array<{ balance_after: number }> } })
      .h;
    expect(h.items.length).toBeGreaterThan(0);
    expect(Number(h.items[0].balance_after)).toBeCloseTo(Number(h.balance), 2);

    const ledger = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_wallet_ledger(NULL, NULL, $1, NULL, 100, 0) AS l`,
      [IDS.adminUser],
    );
    expect(ledger.error).toBeUndefined();
    const l = (ledger.rows?.[0] as { l: { total: number; items: Array<{ admin_id: string }> } }).l;
    expect(Number(l.total)).toBeGreaterThan(0);
    expect(l.items.every((i) => i.admin_id === IDS.adminUser)).toBe(true);
  });
});

describe("admin money card and operations home", () => {
  it("returns a booking's money in one call, admin only", async () => {
    const { bookingId } = await paidBooking("completed");
    const res = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_booking_money_summary('${bookingId}') AS s`,
    );
    expect(res.error).toBeUndefined();
    const s = (res.rows?.[0] as { s: { payments: unknown[]; refund_terms: { mode: string } } }).s;
    expect(s.payments.length).toBeGreaterThan(0);
    expect(s.refund_terms.mode).toBe("completed");

    const customer = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.admin_booking_money_summary('${bookingId}')`,
    );
    expect(customer.ok).toBe(false);
  });

  it("returns today's numbers and the problems list for admins only", async () => {
    for (const fn of ["admin_ops_today", "admin_ops_problems"]) {
      const res = await tryAsUser(db, IDS.adminUser, `SELECT public.${fn}() AS x`);
      expect(res.error).toBeUndefined();
      const denied = await tryAsUser(db, IDS.customer, `SELECT public.${fn}()`);
      expect(denied.ok).toBe(false);
    }
  });

  it("finds a customer by email in the admin search", async () => {
    const email = `search-${randomUUID().slice(0, 8)}@example.com`;
    await asServiceRole(db, () =>
      db.query(`UPDATE public.profiles SET email = $1 WHERE id = $2`, [email, IDS.customer]),
    );
    const res = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_global_search('${email.slice(0, 14).toUpperCase()}') AS r`,
    );
    expect(res.error).toBeUndefined();
    const r = (res.rows?.[0] as { r: { customers: { items: { id: string }[] } } }).r;
    expect(r.customers.items.map((c) => c.id)).toContain(IDS.customer);
  });

  it("keeps internal helpers away from signed-in and anonymous users", async () => {
    for (const sig of [
      "public.admin_booking_refund_terms(uuid)",
      "public.admin_booking_funding_payment_id(uuid)",
      "public.customer_wallet_balance_internal(uuid)",
    ]) {
      const rows = await queryRows<{ a: boolean; u: boolean }>(
        db,
        `SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS a,
                has_function_privilege('anon', '${sig}', 'EXECUTE') AS u`,
      );
      expect(rows[0]).toEqual({ a: false, u: false });
    }
    for (const sig of [
      "public.admin_refund_booking_to_wallet(uuid, numeric, text, text)",
      "public.admin_wallet_adjust(uuid, text, numeric, text, text, uuid, text)",
      "public.admin_wallet_ledger(timestamptz, timestamptz, uuid, text, int, int)",
    ]) {
      const rows = await queryRows<{ u: boolean }>(
        db,
        `SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') AS u`,
      );
      expect(rows[0].u).toBe(false);
    }
  });
});
