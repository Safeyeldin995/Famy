import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  assertTransitionRejected,
  asServiceRole,
  bookingStatus,
  cancellationReasonFor,
  completeHappyPath,
  createBookingLifecycleDb,
  expectRejected,
  IDS,
  lifecycleRescheduleTargetDate,
  paymentStatus,
  queryRows,
  seedLifecycleBooking,
  seedPaymentsForBooking,
  tryAsAnon,
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

describe("booking lifecycle (migration replay)", () => {
  it("happy path: pending through completed and one customer review", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    expect(await bookingStatus(db, bookingId)).toBe("pending");

    await completeHappyPath(db, bookingId);
    expect(await bookingStatus(db, bookingId)).toBe("completed");

    const conv = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.conversations WHERE booking_id = $1`,
      [bookingId],
    );
    expect(conv.length).toBe(1);

    const review = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.reviews (booking_id, customer_id, provider_id, rating, comment)
       SELECT $1, customer_id, provider_id, 5, 'great job'
       FROM public.bookings WHERE id = $1
       RETURNING id`,
      [bookingId],
    );
    expect(review.ok, "customer review insert").toBe(true);

    const dupe = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.reviews (booking_id, customer_id, provider_id, rating, comment)
       SELECT $1, customer_id, provider_id, 4, 'duplicate'
       FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expectRejected(dupe, /unique|duplicate|23505/i, "second review");
  });

  it("cancel_booking: customer at pending and provider at confirmed; not after completed", async () => {
    const pending = await seedLifecycleBooking(db);
    const customerReason = await cancellationReasonFor(db, "customer", ["pending"]);
    const cancelledPending = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.cancel_booking($1::uuid, $2::uuid, 'lifecycle cancel pending') AS id`,
      [pending.bookingId, customerReason],
    );
    expect(cancelledPending.ok).toBe(true);
    expect(await bookingStatus(db, pending.bookingId)).toBe("cancelled");

    const confirmed = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, confirmed.bookingId, "confirmed");
    const providerReason = await cancellationReasonFor(db, "provider", ["confirmed"]);
    const cancelledConfirmed = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.cancel_booking($1::uuid, $2::uuid, NULL) AS id`,
      [confirmed.bookingId, providerReason],
    );
    expect(cancelledConfirmed.ok).toBe(true);

    const completed = await seedLifecycleBooking(db);
    await completeHappyPath(db, completed.bookingId);
    const lateCancel = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.cancel_booking($1::uuid, $2::uuid, NULL) AS id`,
      [completed.bookingId, customerReason],
    );
    expectRejected(lateCancel, /no longer be cancelled|23514/i, "cancel after completed");
  });

  it("rejects direct pending→cancelled without cancel_booking", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    const direct = await updateBookingStatus(db, IDS.customer, bookingId, "cancelled");
    expectRejected(direct, /cancel_booking function/i, "raw cancel");
    expect(await bookingStatus(db, bookingId)).toBe("pending");
  });

  it("expire_pending_bookings only expires stale pending rows", async () => {
    const fresh = await seedLifecycleBooking(db);
    const stale = await seedLifecycleBooking(db);

    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET created_at = now(),
            start_at = now() + interval '48 hours',
            end_at = now() + interval '50 hours'
        WHERE id = '${fresh.bookingId}';
        UPDATE public.bookings
        SET created_at = now() - interval '13 hours'
        WHERE id = '${stale.bookingId}';
      `),
    );

    const expired = await asServiceRole(db, () =>
      queryRows<{ n: number }>(db, `SELECT public.expire_pending_bookings()::int AS n`),
    );
    expect(expired[0]?.n).toBeGreaterThanOrEqual(1);
    expect(await bookingStatus(db, stale.bookingId)).toBe("cancelled");
    expect(await bookingStatus(db, fresh.bookingId)).toBe("pending");
  });

  it("dispute and no-show RPCs enforce eligibility", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");

    const noShow = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.report_no_show($1::uuid, 'provider absent', '{}'::text[]) AS id`,
      [bookingId],
    );
    expect(noShow.ok).toBe(true);
    expect(await bookingStatus(db, bookingId)).toBe("no_show");

    const inProgress = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, inProgress.bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, inProgress.bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, inProgress.bookingId, "arrived");
    await updateBookingStatus(db, IDS.customer, inProgress.bookingId, "arrival_confirmed");
    await updateBookingStatus(db, IDS.providerUser, inProgress.bookingId, "in_progress");

    const dispute = await tryAsUser(
      db,
      IDS.customer,
      `SELECT public.open_booking_dispute(
         $1::uuid, 'quality issue', 'Service quality did not match what was agreed for this booking.', '{}'::text[]
       ) AS id`,
      [inProgress.bookingId],
    );
    expect(dispute.ok).toBe(true);
    expect(await bookingStatus(db, inProgress.bookingId)).toBe("disputed");
  });

  it("reschedule: customer request and provider accept updates slot", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");

    const original = await queryRows<{ start_at: string }>(
      db,
      `SELECT start_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );

    const rescheduleDate = lifecycleRescheduleTargetDate(original[0]!.start_at);

    const request = await tryAsUser(
      db,
      IDS.customer,
      `
        SELECT public.request_reschedule(
          $1::uuid,
          ($2::date + time '14:00') AT TIME ZONE 'Africa/Cairo',
          ($2::date + time '16:00') AT TIME ZONE 'Africa/Cairo',
          'need different time'
        ) AS request_id
      `,
      [bookingId, rescheduleDate],
    );
    expect(request.ok, request.error).toBe(true);
    const requestId = request.rows?.[0]?.request_id as string;

    const accept = await tryAsUser(
      db,
      IDS.providerUser,
      `SELECT public.respond_reschedule($1::uuid, 'accept') AS id`,
      [requestId],
    );
    expect(accept.ok, accept.error).toBe(true);

    const updated = await queryRows<{ start_at: string }>(
      db,
      `SELECT start_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(updated[0]?.start_at).not.toBe(original[0]?.start_at);
  });

  it("booking chat opens on confirm and closes after completion", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");

    const convRows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM public.conversations WHERE booking_id = $1`,
      [bookingId],
    );
    expect(convRows.length).toBe(1);
    const conversationId = convRows[0]!.id;

    const openChat = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.messages (conversation_id, body) VALUES ($1::uuid, 'hello provider') RETURNING id`,
      [conversationId],
    );
    expect(openChat.ok).toBe(true);

    await completeHappyPath(db, bookingId);

    const closedChat = await tryAsUser(
      db,
      IDS.customer,
      `INSERT INTO public.messages (conversation_id, body) VALUES ($1::uuid, 'after complete') RETURNING id`,
      [conversationId],
    );
    expectRejected(closedChat, /not open|42501/i, "chat after completed");
  });

  it("lets the customer confirm arrival before the scheduled start time", async () => {
    const { bookingId } = await seedLifecycleBooking(db);
    await asServiceRole(db, () =>
      db.exec(`
        UPDATE public.bookings
        SET start_at = now() + interval '2 hours',
            end_at = now() + interval '4 hours'
        WHERE id = '${bookingId}';
      `),
    );
    await updateBookingStatus(db, IDS.providerUser, bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, bookingId, "arrived");

    const confirm = await updateBookingStatus(db, IDS.customer, bookingId, "arrival_confirmed");
    expect(confirm.ok, confirm.error ?? "customer confirm arrival").toBe(true);
    expect(await bookingStatus(db, bookingId)).toBe("arrival_confirmed");

    const meta = await queryRows<{ arrival_confirmed_at: string | null }>(
      db,
      `SELECT arrival_confirmed_at::text FROM public.bookings WHERE id = $1`,
      [bookingId],
    );
    expect(meta[0]?.arrival_confirmed_at).toBeTruthy();
  });

  it("rejects skipped transitions and wrong lifecycle actors", async () => {
    const pending = await seedLifecycleBooking(db);
    await assertTransitionRejected(
      db,
      IDS.providerUser,
      pending.bookingId,
      "in_progress",
      /not permitted|42501/i,
      "provider skip to in_progress",
    );
    await assertTransitionRejected(
      db,
      IDS.providerUser,
      pending.bookingId,
      "completed",
      /not permitted|42501/i,
      "provider skip to completed",
    );

    const atArrived = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, atArrived.bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, atArrived.bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, atArrived.bookingId, "arrived");
    await assertTransitionRejected(
      db,
      IDS.providerUser,
      atArrived.bookingId,
      "arrival_confirmed",
      /not permitted|42501/i,
      "provider cannot confirm own arrival",
    );

    const atCompletionRequested = await seedLifecycleBooking(db);
    await updateBookingStatus(db, IDS.providerUser, atCompletionRequested.bookingId, "confirmed");
    await updateBookingStatus(db, IDS.providerUser, atCompletionRequested.bookingId, "on_the_way");
    await updateBookingStatus(db, IDS.providerUser, atCompletionRequested.bookingId, "arrived");
    await updateBookingStatus(db, IDS.customer, atCompletionRequested.bookingId, "arrival_confirmed");
    await updateBookingStatus(db, IDS.providerUser, atCompletionRequested.bookingId, "in_progress");
    await updateBookingStatus(
      db,
      IDS.providerUser,
      atCompletionRequested.bookingId,
      "completion_requested",
    );
    await assertTransitionRejected(
      db,
      IDS.providerUser,
      atCompletionRequested.bookingId,
      "completed",
      /not permitted|42501/i,
      "provider cannot complete booking",
    );
  });

  it("negative: role boundaries, pricing, and payment writes", async () => {
    const { bookingId } = await seedLifecycleBooking(db);

    await assertTransitionRejected(
      db,
      IDS.customer,
      bookingId,
      "confirmed",
      /not permitted|42501/i,
      "customer confirm",
    );

    const other = await seedLifecycleBooking(db, { providerId: IDS.otherProvider });
    const wrongProvider = await updateBookingStatus(
      db,
      IDS.providerUser,
      other.bookingId,
      "confirmed",
    );
    const otherStatus = await bookingStatus(db, other.bookingId);
    expect(
      wrongProvider.ok && otherStatus === "confirmed",
      "provider must not confirm another provider's booking",
    ).toBe(false);

    expectRejected(
      await tryAsUser(
        db,
        IDS.customer,
        `UPDATE public.bookings SET price_total = 1 WHERE id = $1 RETURNING price_total`,
        [bookingId],
      ),
      /pricing cannot be changed|42501/i,
      "customer price_total tamper",
    );

    expectRejected(
      await tryAsUser(
        db,
        IDS.providerUser,
        `UPDATE public.bookings SET price_total = 1 WHERE id = $1 RETURNING price_total`,
        [bookingId],
      ),
      /pricing cannot be changed|42501/i,
      "provider price_total tamper",
    );

    expectRejected(
      await tryAsAnon(db, `UPDATE public.bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]),
      /permission|42501|not permitted/i,
      "anon update",
    );

    await completeHappyPath(db, bookingId);
    expectRejected(
      await updateBookingStatus(db, IDS.providerUser, bookingId, "cancelled"),
      /cancel_booking|not permitted|42501/i,
      "cancel completed",
    );

    const { cashId, paymobId } = await seedPaymentsForBooking(db, bookingId);

    const customerCapture = await tryAsUser(
      db,
      IDS.customer,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status::text AS status`,
      [cashId],
    );
    expect(await paymentStatus(db, cashId)).toBe("pending");
    if (customerCapture.ok && customerCapture.rows?.[0]?.status === "captured") {
      throw new Error("customer self-capture cash should be rejected");
    }
    if (!customerCapture.ok) {
      expectRejected(customerCapture, /proof|not authorized|42501/i, "customer self-capture cash");
    }

    const providerPaymob = await tryAsUser(
      db,
      IDS.providerUser,
      `UPDATE public.payments SET status = 'captured' WHERE id = $1 RETURNING status::text AS status`,
      [paymobId],
    );
    expect(await paymentStatus(db, paymobId)).toBe("pending");
    if (providerPaymob.ok && providerPaymob.rows?.[0]?.status === "captured") {
      throw new Error("provider paymob capture should be rejected");
    }
    if (!providerPaymob.ok) {
      expectRejected(
        providerPaymob,
        /payment gateway|not authorized|42501/i,
        "provider paymob capture",
      );
    }
  });
});
