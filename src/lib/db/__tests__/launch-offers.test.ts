import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  setBookingStatusAsSystem,
  tryAsAnon,
  tryAsUser,
} from "./booking-lifecycle.harness";

/**
 * Launch offers (20261128160000_launch_offers):
 *   1) «ضمان أول حصة»: the first completed lesson with a tutor can go back to
 *      the wallet once, from Famy's pocket, capped on the money still held.
 *   2) A lower commission for new tutors, snapshotted on the booking.
 *
 * The lifecycle fixture books babysitting, so the tests add 'babysitting' to the
 * covered categories (the production default covers tutoring, quran, music).
 */
let db: PGlite;
let nextOrder = 991000;

const GUARANTEE_ON = {
  enabled: true,
  window_hours: 24,
  max_per_30_days: 2,
  category_slugs: ["tutoring", "quran", "music", "babysitting"],
};

async function setSetting(key: string, value: unknown) {
  await db.query(
    `INSERT INTO public.settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

/** Test isolation: forget earlier claims and make earlier lessons not count. */
async function isolate() {
  await db.exec(`
    SET session_replication_role = replica;
    DELETE FROM public.first_lesson_guarantee_claims;
    UPDATE public.bookings SET status = 'cancelled' WHERE status = 'completed';
    DELETE FROM public.provider_onboarding_events;
    SET session_replication_role = origin;
  `);
  await setSetting("first_lesson_guarantee", GUARANTEE_ON);
}

async function capture(paymentId: string, type: "online" | "cash" = "online") {
  const orderId = nextOrder++;
  const code = type === "cash" ? "cash_on_delivery" : "paymob";
  await asServiceRole(db, () =>
    db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET status = 'captured', captured_at = now(), payment_method_type = '${type}',
          payment_method_code = '${code}', method = '${code === "paymob" ? "paymob" : "cash"}',
          paymob_order_id = ${type === "online" ? orderId : "NULL"}, currency = 'EGP'
      WHERE id = '${paymentId}';
    `),
  );
  return orderId;
}

/** A completed lesson. completed_at is set first so the ledger sees it. */
async function completedLesson(opts?: {
  providerId?: string;
  pay?: "card" | "cash" | "card_pending" | "none";
  completedHoursAgo?: number;
}) {
  const { bookingId } = await seedLifecycleBooking(db, { providerId: opts?.providerId });
  const { paymobId, cashId } = await seedPaymentsForBooking(db, bookingId);
  const pay = opts?.pay ?? "card";
  let orderId: number | null = null;
  let paymentId: string | null = null;
  if (pay === "card") {
    orderId = await capture(paymobId);
    paymentId = paymobId;
    await db.exec(`UPDATE public.payments SET status = 'failed' WHERE id = '${cashId}'`);
  } else if (pay === "cash") {
    await db.exec(`UPDATE public.payments SET status = 'failed' WHERE id = '${paymobId}'`);
    await capture(cashId, "cash");
    paymentId = cashId;
  } else if (pay === "card_pending") {
    // The card payment was started but never captured.
    await db.exec(`
      UPDATE public.payments SET status = 'failed' WHERE id = '${cashId}';
      UPDATE public.payments SET payment_method_type = 'online', payment_method_code = 'paymob'
      WHERE id = '${paymobId}';
    `);
    paymentId = paymobId;
  } else {
    // No payment at all (the ledger would capture a cash row on completion).
    await db.exec(`
      SET session_replication_role = replica;
      DELETE FROM public.payments WHERE id IN ('${paymobId}', '${cashId}');
      SET session_replication_role = origin;
    `);
  }
  const hours = opts?.completedHoursAgo ?? 0;
  await db.exec(`
    SET session_replication_role = replica;
    UPDATE public.bookings SET completed_at = now() - interval '${hours} hours'
    WHERE id = '${bookingId}';
    SET session_replication_role = origin;
  `);
  await setBookingStatusAsSystem(db, bookingId, "completed");
  return { bookingId, paymentId, orderId };
}

async function priceTotal(bookingId: string): Promise<number> {
  const rows = await queryRows<{ p: string }>(
    db,
    `SELECT price_total::text AS p FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  return Number(rows[0].p);
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

const status = async (bookingId: string, user: string = IDS.customer) => {
  const res = await tryAsUser(db, user, `SELECT public.first_lesson_guarantee_status($1) AS s`, [
    bookingId,
  ]);
  expect(res.error).toBeUndefined();
  return (res.rows?.[0] as { s: Record<string, unknown> }).s;
};

const claim = (bookingId: string, user: string = IDS.customer, feedback: string | null = null) =>
  tryAsUser(db, user, `SELECT public.claim_first_lesson_guarantee($1, $2) AS r`, [
    bookingId,
    feedback,
  ]);

const claimResult = (res: Awaited<ReturnType<typeof claim>>) =>
  (res.rows?.[0] as { r: Record<string, unknown> }).r;

const adminQuote = async (bookingId: string) => {
  const res = await tryAsUser(
    db,
    IDS.adminUser,
    `SELECT public.admin_booking_wallet_refund_quote($1) AS q`,
    [bookingId],
  );
  expect(res.error).toBeUndefined();
  return (res.rows?.[0] as { q: Record<string, unknown> }).q;
};

async function heldOnPayment(paymentId: string): Promise<number> {
  const rows = await queryRows<{ h: string }>(
    db,
    `SELECT public.payment_held_after_card_refund(p)::text AS h FROM public.payments p WHERE p.id = $1`,
    [paymentId],
  );
  return Number(rows[0].h);
}

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  await db.exec(`
    INSERT INTO public.settings (key, value)
    VALUES ('billing', '{"platform_fee": 25, "vat_percent": 14, "commission_percent": 15, "commission_percent_online": 15}'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);
  // The commission tests turn the launch offer on themselves.
  await setSetting("launch_commission", {
    enabled: false,
    percent_in_person: 7.5,
    percent_online: 7.5,
    duration_days: 30,
    starts_at: "2026-01-01T00:00:00Z",
    category_slugs: ["tutoring", "quran", "music"],
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("first-lesson guarantee", () => {
  beforeEach(async () => {
    await isolate();
  });

  it("refunds the paid lesson price to the wallet once; the tutor keeps their share", async () => {
    const { bookingId, paymentId } = await completedLesson();
    const price = await priceTotal(bookingId);
    const shareBefore = await queryRows<{ n: string }>(
      db,
      `SELECT COALESCE(sum(amount), 0)::text AS n FROM public.provider_ledger_entries
       WHERE booking_id = $1 AND kind = 'online_provider_share'`,
      [bookingId],
    );
    expect(Number(shareBefore[0].n)).toBeGreaterThan(0);

    const s = await status(bookingId);
    expect(s.eligible).toBe(true);
    expect(Number(s.amount)).toBe(price);

    const before = await walletBalance();
    const res = await claim(bookingId, IDS.customer, "المدرس مكانش مناسب لابني");
    expect(res.error).toBeUndefined();
    const r = claimResult(res);
    expect(r.replayed).toBe(false);
    expect(Number(r.amount)).toBe(price);
    expect(await walletBalance()).toBeCloseTo(before + price, 2);

    const entries = await queryRows<{ reason: string; booking_id: string; payment_id: string }>(
      db,
      `SELECT reason, booking_id::text, payment_id::text FROM public.customer_wallet_entries WHERE id = $1`,
      [r.wallet_entry_id],
    );
    expect(entries[0]).toEqual({
      reason: "first_lesson_guarantee",
      booking_id: bookingId,
      payment_id: paymentId,
    });

    // Payment stays captured; the refunded total is tracked; nothing left to refund.
    const pay = await queryRows<{ status: string; refunded: string }>(
      db,
      `SELECT status::text, metadata->>'wallet_refunded_total' AS refunded FROM public.payments WHERE id = $1`,
      [paymentId],
    );
    expect(pay[0].status).toBe("captured");
    expect(Number(pay[0].refunded)).toBe(price);
    expect(await heldOnPayment(paymentId!)).toBe(0);
    expect((await adminQuote(bookingId)).blocked).toBe("nothing_left");

    const shareAfter = await queryRows<{ n: string }>(
      db,
      `SELECT COALESCE(sum(amount), 0)::text AS n FROM public.provider_ledger_entries
       WHERE booking_id = $1 AND kind = 'online_provider_share'`,
      [bookingId],
    );
    expect(shareAfter[0].n).toBe(shareBefore[0].n);

    // Replaying returns the same claim and pays nothing more.
    const again = await claim(bookingId);
    expect(again.error).toBeUndefined();
    expect(claimResult(again).replayed).toBe(true);
    expect(await walletBalance()).toBeCloseTo(before + price, 2);

    const after = await status(bookingId);
    expect(after.blocked).toBe("already_claimed");
    expect((after.claim as { status: string }).status).toBe("claimed");
  });

  it("refuses a second claim with the same tutor, a later lesson, and the monthly cap", async () => {
    const first = await completedLesson();
    expect((await claim(first.bookingId)).error).toBeUndefined();

    // A later lesson with the same tutor and child is not the first lesson.
    const second = await completedLesson();
    expect((await status(second.bookingId)).blocked).toBe("not_first_lesson");
    const refused = await claim(second.bookingId);
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/GUARANTEE_BLOCKED:not_first_lesson/);

    // The customer's own first lesson with the same tutor: once per tutor.
    await db.exec(`
      SET session_replication_role = replica;
      UPDATE public.bookings SET family_member_id = NULL WHERE id = '${second.bookingId}';
      SET session_replication_role = origin;
    `);
    expect((await status(second.bookingId)).blocked).toBe("tutor_already_used");

    // Monthly cap: 1 per 30 days blocks a first lesson with another tutor.
    await setSetting("first_lesson_guarantee", { ...GUARANTEE_ON, max_per_30_days: 1 });
    const other = await completedLesson({ providerId: IDS.otherProvider });
    expect((await status(other.bookingId)).blocked).toBe("monthly_limit");
    expect((await claim(other.bookingId)).error).toMatch(/GUARANTEE_BLOCKED:monthly_limit/);
  });

  it("never pays back money Paymob already returned to the card", async () => {
    const { bookingId, paymentId, orderId } = await completedLesson();
    const price = await priceTotal(bookingId);
    const partialCents = 5000;
    await asServiceRole(db, () =>
      queryRows(
        db,
        "SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, $3::bigint, false, '{}'::jsonb, 'transaction', NULL)",
        [nextOrder++ * 10, orderId, partialCents],
      ),
    );
    // While the Paymob flag the refund raised is open, nothing is paid.
    expect((await status(bookingId)).blocked).toBe("money_flag_open");

    // The admin checked Paymob and resolved the flag.
    await db.exec(`
      SELECT set_config('app.ledger_internal_capture', 'on', true);
      UPDATE public.payments
      SET metadata = metadata || jsonb_build_object('paymob_resolved_at', now())
      WHERE id = '${paymentId}';
    `);
    const s = await status(bookingId);
    expect(s.blocked).toBeNull();
    expect(Number(s.amount)).toBeCloseTo(price - partialCents / 100, 2);

    const before = await walletBalance();
    const res = await claim(bookingId);
    expect(res.error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before + price - partialCents / 100, 2);
    expect(await heldOnPayment(paymentId!)).toBe(0);
  });

  it("is blocked while a card refund of unknown amount is open, and when the card was fully refunded", async () => {
    const a = await completedLesson();
    await asServiceRole(db, () =>
      queryRows(
        db,
        "SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, NULL, false, '{}'::jsonb, 'cumulative', NULL)",
        [nextOrder++ * 10, a.orderId],
      ),
    );
    expect((await status(a.bookingId)).blocked).toMatch(/card_refund_unknown|money_flag_open/);
    expect((await claim(a.bookingId)).ok).toBe(false);

    await isolate();
    const b = await completedLesson();
    const fullCents = Math.round((await priceTotal(b.bookingId)) * 100);
    await asServiceRole(db, () =>
      queryRows(
        db,
        "SELECT public.paymob_apply_refund_webhook($1::bigint, $2::bigint, 999999::bigint, false, '{}'::jsonb, 'cumulative', $3::bigint)",
        [nextOrder++ * 10, b.orderId, fullCents],
      ),
    );
    const s = await status(b.bookingId);
    expect(s.eligible).toBe(false);
    expect(Number(s.amount)).toBe(0);
    expect((await claim(b.bookingId)).ok).toBe(false);
  });

  it("covers a collected cash lesson, waits for an unsettled payment, refuses an unpaid one", async () => {
    const pending = await completedLesson({ pay: "card_pending" });
    expect((await status(pending.bookingId)).blocked).toBe("payment_not_settled");

    await isolate();
    const cash = await completedLesson({ pay: "cash" });
    const price = await priceTotal(cash.bookingId);
    const s = await status(cash.bookingId);
    expect(s.eligible).toBe(true);
    expect(Number(s.amount)).toBe(price);
    const before = await walletBalance();
    expect((await claim(cash.bookingId)).error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before + price, 2);

    await isolate();
    const unpaid = await completedLesson({ pay: "none" });
    expect((await status(unpaid.bookingId)).blocked).toBe("no_payment");
  });

  it("closes after the window, skips uncovered categories, and only the customer can claim", async () => {
    const late = await completedLesson({ completedHoursAgo: 25 });
    expect((await status(late.bookingId)).blocked).toBe("window_closed");

    await isolate();
    const lesson = await completedLesson();
    await setSetting("first_lesson_guarantee", {
      ...GUARANTEE_ON,
      category_slugs: ["tutoring", "quran", "music"],
    });
    expect((await status(lesson.bookingId)).blocked).toBe("category_not_covered");
    await setSetting("first_lesson_guarantee", { ...GUARANTEE_ON, enabled: false });
    expect((await status(lesson.bookingId)).blocked).toBe("disabled");
    await setSetting("first_lesson_guarantee", GUARANTEE_ON);

    const stranger = await claim(lesson.bookingId, IDS.providerUser);
    expect(stranger.ok).toBe(false);
    expect(stranger.error).toMatch(/Booking not found/);
    const anon = await tryAsAnon(
      db,
      `SELECT public.claim_first_lesson_guarantee('${lesson.bookingId}', NULL)`,
    );
    expect(anon.ok).toBe(false);
  });

  it("lets the admin reverse a claim, never below a zero balance", async () => {
    const { bookingId, paymentId } = await completedLesson();
    const price = await priceTotal(bookingId);
    expect((await claim(bookingId)).error).toBeUndefined();
    const claimRow = await queryRows<{ id: string }>(
      db,
      `SELECT id::text FROM public.first_lesson_guarantee_claims WHERE booking_id = $1`,
      [bookingId],
    );
    const claimId = claimRow[0].id;

    const asAdmin = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_first_lesson_guarantee_for_booking($1) AS c`,
      [bookingId],
    );
    expect((asAdmin.rows?.[0] as { c: { status: string } }).c.status).toBe("claimed");
    const notAdmin = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.admin_reverse_first_lesson_guarantee($1, 'x', 'k')`,
      [claimId],
    );
    expect(notAdmin.error).toMatch(/Admin required/);

    // Spend the wallet down so the reversal cannot be covered.
    const balance = await walletBalance();
    await asServiceRole(db, () =>
      db.query(
        `SELECT public.customer_wallet_insert_entry($1, 'debit', $2, 'admin_debit', NULL, NULL, NULL, $3, '{}'::jsonb)`,
        [IDS.customer, balance - price / 2, randomUUID()],
      ),
    );
    const tooLow = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_reverse_first_lesson_guarantee($1, 'استخدام غلط', $2)`,
      [claimId, randomUUID()],
    );
    expect(tooLow.error).toMatch(/WALLET_BALANCE_TOO_LOW/);

    await asServiceRole(db, () =>
      db.query(
        `SELECT public.customer_wallet_insert_entry($1, 'credit', $2, 'admin_credit', NULL, NULL, NULL, $3, '{}'::jsonb)`,
        [IDS.customer, price, randomUUID()],
      ),
    );
    const before = await walletBalance();
    const key = randomUUID();
    const ok = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_reverse_first_lesson_guarantee($1, 'استخدام غلط', $2) AS r`,
      [claimId, key],
    );
    expect(ok.error).toBeUndefined();
    expect(await walletBalance()).toBeCloseTo(before - price, 2);
    expect(await heldOnPayment(paymentId!)).toBeCloseTo(price, 2);
    const replay = await tryAsUser(
      db,
      IDS.adminUser,
      `SELECT public.admin_reverse_first_lesson_guarantee($1, 'استخدام غلط', $2) AS r`,
      [claimId, key],
    );
    expect((replay.rows?.[0] as { r: { replayed: boolean } }).r.replayed).toBe(true);
    expect(await walletBalance()).toBeCloseTo(before - price, 2);

    // The booking cannot be claimed again.
    expect((await status(bookingId)).blocked).toBe("already_claimed");
  });

  it("keeps internal helpers and the claims table away from clients", async () => {
    for (const fn of [
      "public.first_lesson_guarantee_terms(uuid)",
      "public.first_lesson_guarantee_payment_id(uuid)",
      "public.launch_commission_percent_internal(uuid, uuid, text, timestamptz)",
      "public.launch_commission_window(uuid)",
      "public.provider_first_approved_at(uuid)",
    ]) {
      const rows = await queryRows<{ auth: boolean; anon: boolean }>(
        db,
        `SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS auth,
                has_function_privilege('anon', '${fn}', 'EXECUTE') AS anon`,
      );
      expect(rows[0]).toEqual({ auth: false, anon: false });
    }
    const write = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.first_lesson_guarantee_claims (booking_id, customer_id, provider_id, payment_id, amount, wallet_entry_id)
       VALUES (gen_random_uuid(), '${IDS.customer}', '${IDS.provider}', gen_random_uuid(), 1, gen_random_uuid())`,
    );
    expect(write.ok).toBe(false);
  });
});

describe("launch commission", () => {
  const OFFER = {
    enabled: true,
    percent_in_person: 7.5,
    percent_online: 7.5,
    duration_days: 30,
    starts_at: "2026-01-01T00:00:00Z",
    category_slugs: ["tutoring", "quran", "music", "babysitting"],
  };

  async function approvedAt(interval: string) {
    await db.exec(`
      SET session_replication_role = replica;
      DELETE FROM public.provider_onboarding_events WHERE provider_id = '${IDS.provider}';
      INSERT INTO public.provider_onboarding_events (provider_id, actor_role, action, previous_status, new_status, created_at)
      VALUES ('${IDS.provider}', 'admin', 'approve', 'SUBMITTED', 'APPROVED', now() - interval '${interval}');
      SET session_replication_role = origin;
    `);
  }

  async function commission(bookingId: string) {
    const rows = await queryRows<{
      pct: string;
      amount: string;
      net: string;
      regular: string | null;
      total: string;
    }>(
      db,
      `SELECT price_commission_percent::text AS pct, price_commission_amount::text AS amount,
              price_provider_net::text AS net, price_commission_regular_percent::text AS regular,
              price_total::text AS total
       FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    return rows[0];
  }

  beforeEach(async () => {
    await setSetting("launch_commission", { ...OFFER, enabled: false });
  });

  it("books a new tutor at the launch rate inside the window and the regular rate after it", async () => {
    await setSetting("launch_commission", OFFER);
    await approvedAt("30 days - 5 minutes");
    const inside = (await seedLifecycleBooking(db)).bookingId;
    const c1 = await commission(inside);
    expect(c1.pct).toBe("7.50");
    expect(c1.regular).toBe("15.00");
    // Provider net + commission = commission base (+ travel); nothing lost.
    expect(Number(c1.net) + Number(c1.amount)).toBeGreaterThan(0);

    await approvedAt("30 days + 5 minutes");
    const outside = (await seedLifecycleBooking(db)).bookingId;
    const c2 = await commission(outside);
    expect(c2.pct).toBe("15.00");
    expect(c2.regular).toBeNull();
    // Same base, so the launch booking's net is higher by exactly half the commission.
    expect(Number(c1.amount) * 2).toBeCloseTo(Number(c2.amount), 2);
    expect(Number(c1.net) - Number(c2.net)).toBeCloseTo(Number(c1.amount), 2);
  });

  it("counts the window from the offer start for tutors approved before it", async () => {
    await approvedAt("200 days");
    await setSetting("launch_commission", {
      ...OFFER,
      starts_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    const b = (await seedLifecycleBooking(db)).bookingId;
    expect((await commission(b)).pct).toBe("7.50");

    await setSetting("launch_commission", {
      ...OFFER,
      starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const notYet = (await seedLifecycleBooking(db)).bookingId;
    expect((await commission(notYet)).pct).toBe("15.00");
  });

  it("never changes existing bookings when the offer changes", async () => {
    await approvedAt("1 day");
    const regular = (await seedLifecycleBooking(db)).bookingId;
    expect((await commission(regular)).pct).toBe("15.00");

    await setSetting("launch_commission", OFFER);
    expect((await commission(regular)).pct).toBe("15.00");
    const launch = (await seedLifecycleBooking(db)).bookingId;
    const before = await commission(launch);
    expect(before.pct).toBe("7.50");

    await setSetting("launch_commission", { ...OFFER, enabled: false });
    await setSetting("billing", {
      platform_fee: 25,
      vat_percent: 14,
      commission_percent: 20,
      commission_percent_online: 20,
    });
    expect(await commission(launch)).toEqual(before);
    expect((await commission(regular)).pct).toBe("15.00");

    // The snapshot column cannot be rewritten afterwards.
    await asServiceRole(db, () =>
      db.exec(
        `UPDATE public.bookings SET price_commission_regular_percent = 1 WHERE id = '${launch}'`,
      ),
    );
    expect((await commission(launch)).regular).toBe("15.00");
    await setSetting("billing", {
      platform_fee: 25,
      vat_percent: 14,
      commission_percent: 15,
      commission_percent_online: 15,
    });
  });

  it("skips categories outside the offer and never raises the commission", async () => {
    await approvedAt("1 day");
    await setSetting("launch_commission", {
      ...OFFER,
      category_slugs: ["tutoring", "quran", "music"],
    });
    const babysitting = (await seedLifecycleBooking(db)).bookingId;
    expect((await commission(babysitting)).pct).toBe("15.00");

    await setSetting("launch_commission", { ...OFFER, percent_in_person: 40, percent_online: 40 });
    const higher = (await seedLifecycleBooking(db)).bookingId;
    expect((await commission(higher)).pct).toBe("15.00");
  });

  it("tells the provider until when their commission is lower", async () => {
    await approvedAt("1 day");
    await setSetting("launch_commission", OFFER);
    const res = await tryAsUser(db, IDS.providerUser, `SELECT public.my_launch_commission() AS m`);
    expect(res.error).toBeUndefined();
    const m = (res.rows?.[0] as { m: Record<string, unknown> }).m;
    expect(m.active).toBe(true);
    expect(Number(m.percent_in_person)).toBe(7.5);
    expect(Number(m.regular_in_person)).toBe(15);
    const ends = new Date(String(m.ends_at)).getTime();
    expect(ends).toBeGreaterThan(Date.now() + 28 * 86_400_000);
    expect(ends).toBeLessThan(Date.now() + 30 * 86_400_000);

    // A tutor with no service in a covered section does not see it.
    await setSetting("launch_commission", { ...OFFER, category_slugs: ["quran"] });
    const uncovered = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.my_launch_commission() AS m`,
    );
    expect((uncovered.rows?.[0] as { m: { active: boolean } }).m.active).toBe(false);

    await setSetting("launch_commission", { ...OFFER, enabled: false });
    const off = await tryAsUser(db, IDS.providerUser, `SELECT public.my_launch_commission() AS m`);
    expect((off.rows?.[0] as { m: { active: boolean } }).m.active).toBe(false);
  });

  it("rejects invalid offer settings", async () => {
    const bad = [
      { ...OFFER, percent_online: 60 },
      { ...OFFER, percent_online: 7.555 },
      { ...OFFER, duration_days: 0 },
      { ...OFFER, starts_at: "not a date" },
      { ...OFFER, category_slugs: [] },
    ];
    for (const value of bad) {
      await expect(setSetting("launch_commission", value)).rejects.toThrow(/LAUNCH_OFFER_INVALID/);
    }
    for (const value of [
      { ...GUARANTEE_ON, window_hours: 0 },
      { ...GUARANTEE_ON, window_hours: 2.5 },
      { ...GUARANTEE_ON, max_per_30_days: 11 },
      { ...GUARANTEE_ON, enabled: "yes" },
    ]) {
      await expect(setSetting("first_lesson_guarantee", value)).rejects.toThrow(
        /LAUNCH_OFFER_INVALID/,
      );
    }
  });
});
