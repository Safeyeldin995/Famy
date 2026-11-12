import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  cancellationReasonFor,
  completeHappyPath,
  createBookingLifecycleDb,
  expectRejected,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsUser,
  updateBookingStatus,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function conversationForBooking(db: PGlite, bookingId: string): Promise<string> {
  const convRows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM public.conversations WHERE booking_id = $1`,
    [bookingId],
  );
  expect(convRows.length).toBe(1);
  return convRows[0]!.id;
}

async function tryCustomerMessage(db: PGlite, conversationId: string, body: string) {
  return tryAsUser(
    db,
    IDS.customer,
    `INSERT INTO public.messages (conversation_id, body) VALUES ($1::uuid, $2) RETURNING id`,
    [conversationId, body],
  );
}

describe("chat_closed on terminal booking statuses", () => {
  it("rejects customer inserts after completed, cancelled, and no_show", async () => {
    const completedSeed = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, completedSeed.bookingId, "confirmed");
    await completeHappyPath(db, completedSeed.bookingId);
    const completedConv = await conversationForBooking(db, completedSeed.bookingId);
    expectRejected(
      await tryCustomerMessage(db, completedConv, "after completed"),
      /chat_closed/i,
      "chat after completed",
    );

    const cancelledSeed = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, cancelledSeed.bookingId, "confirmed");
    const reason = await cancellationReasonFor(db, "customer", ["confirmed"]);
    const cancelled = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.cancel_booking($1::uuid, $2::uuid, 'close chat test') AS id`,
      [cancelledSeed.bookingId, reason],
    );
    expect(cancelled.ok).toBe(true);
    const cancelledConv = await conversationForBooking(db, cancelledSeed.bookingId);
    expectRejected(
      await tryCustomerMessage(db, cancelledConv, "after cancelled"),
      /chat_closed/i,
      "chat after cancelled",
    );

    const noShowSeed = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, noShowSeed.bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, noShowSeed.bookingId, "on_the_way");
    const noShow = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.report_no_show($1::uuid, 'provider absent', '{}'::text[]) AS id`,
      [noShowSeed.bookingId],
    );
    expect(noShow.ok).toBe(true);
    const noShowConv = await conversationForBooking(db, noShowSeed.bookingId);
    expectRejected(
      await tryCustomerMessage(db, noShowConv, "after no_show"),
      /chat_closed/i,
      "chat after no_show",
    );
  });

  it("allows customer inserts while confirmed and in_progress", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    const conversationId = await conversationForBooking(db, bookingId);
    expect((await tryCustomerMessage(db, conversationId, "while confirmed")).ok).toBe(true);

    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");
    await updateBookingStatus(db, IDS.customer, bookingId, "arrival_confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "in_progress");
    expect((await tryCustomerMessage(db, conversationId, "while in progress")).ok).toBe(true);
  });

  it("allows admin insert after completed", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await completeHappyPath(db, bookingId);
    const conversationId = await conversationForBooking(db, bookingId);

    const adminInsert = await tryAsUser(
      db,
      IDS.adminUser,
      `INSERT INTO public.messages (conversation_id, body) VALUES ($1::uuid, 'support follow-up') RETURNING id`,
      [conversationId],
    );
    expect(adminInsert.ok, adminInsert.error ?? "admin after completed").toBe(true);
  });
});
