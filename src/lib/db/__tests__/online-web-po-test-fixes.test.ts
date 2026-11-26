import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  IDS,
  cancellationReasonFor,
  createBookingLifecycleDb,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
} from "./booking-lifecycle.harness";

const STRANGER = "00000000-0000-0000-0000-000000000099";

async function notificationsFor(db: PGlite, userId: string, bookingId: string) {
  return queryRows<{ type: string; title_ar: string; body_ar: string; deep_link: string }>(
    db,
    `SELECT type, title_ar, body_ar, deep_link
       FROM public.notifications
      WHERE user_id = $1 AND booking_id = $2
      ORDER BY created_at, type`,
    [userId, bookingId],
  );
}

describe("online web PO test fixes (20261126120000)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createBookingLifecycleDb();
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("tells the customer the request was sent", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    const rows = await notificationsFor(db, IDS.customer, bookingId);
    expect(rows.map((r) => r.type)).toContain("booking_requested");
    const sent = rows.find((r) => r.type === "booking_requested")!;
    expect(sent.title_ar).toBe("طلبك اتبعت");
    expect(sent.deep_link).toBe(`/booking/${bookingId}`);
  });

  it("confirms a cancelled pending request to both sides, free of charge", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    const reasonId = await cancellationReasonFor(db, "customer", ["pending"]);
    const res = await tryAsUser(db, IDS.customer, `SELECT public.cancel_booking($1, $2, NULL)`, [
      bookingId,
      reasonId,
    ]);
    expect(res.error).toBeUndefined();

    const customer = await notificationsFor(db, IDS.customer, bookingId);
    const mine = customer.find((r) => r.type === "booking_cancelled_by_you");
    expect(mine?.title_ar).toBe("طلبك اتلغى");
    expect(mine?.body_ar).toContain("مفيش أي رسوم");

    const provider = await notificationsFor(db, IDS.providerUser, bookingId);
    const theirs = provider.find((r) => r.type === "booking_cancelled");
    expect(theirs?.title_ar).toBe("الطلب اتلغى");
  });

  it("lets only booking participants read the provider card", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    for (const user of [IDS.customer, IDS.providerUser]) {
      const res = await tryAsUser(
        db,
        user,
        `SELECT provider_id, full_name FROM public.booking_provider_card($1)`,
        [bookingId],
      );
      expect(res.error).toBeUndefined();
      expect(res.rows?.[0]?.provider_id).toBe(IDS.provider);
    }
    const stranger = await tryAsUser(db, STRANGER, `SELECT * FROM public.booking_provider_card($1)`, [
      bookingId,
    ]);
    expect(stranger.ok).toBe(false);

    const grants = await queryRows<{ anon: boolean; auth: boolean; trg_auth: boolean }>(
      db,
      `SELECT has_function_privilege('anon', 'public.booking_provider_card(uuid)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.booking_provider_card(uuid)', 'EXECUTE') AS auth,
              has_function_privilege('authenticated', 'public.tg_booking_cancellation_notify_customer()', 'EXECUTE') AS trg_auth`,
    );
    expect(grants[0]).toEqual({ anon: false, auth: true, trg_auth: false });
  });

  it("links online booking notifications to the online lesson page", async () => {
    const src = await queryRows<{ src: string }>(
      db,
      `SELECT prosrc AS src FROM pg_proc WHERE proname = 'tg_booking_notify'`,
    );
    expect(src[0]?.src).toContain("'/online/lessons/' || NEW.id");
  });
});
