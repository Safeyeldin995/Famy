import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
  tryAsAnon,
  tryAsUser,
} from "./booking-lifecycle.harness";

/**
 * Online lesson attendance from the server-side LiveKit presence poller
 * (20261126190000_online_presence_poller.sql): the system no longer depends on
 * the LiveKit webhook, and never settles an absence without evidence.
 */
let db: PGlite;

const LESSON_END = "2026-11-25T17:30:00+00";
const LESSON_START = "2026-11-25T16:30:00+00";

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function makeOnline(bookingId: string, startSql: string, endSql: string) {
  await db.exec(`
    ALTER TABLE public.bookings DISABLE TRIGGER trg_lock_booking_service_mode;
    UPDATE public.bookings
    SET service_mode = 'online',
        start_at = ${startSql},
        end_at = ${endSql},
        online_session_outcome = NULL,
        price_total = 200,
        price_provider_net = 160
    WHERE id = '${bookingId}';
    ALTER TABLE public.bookings ENABLE TRIGGER trg_lock_booking_service_mode;
  `);
}

async function pastOnlineLesson(): Promise<string> {
  const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
  await makeOnline(bookingId, `timestamptz '${LESSON_START}'`, `timestamptz '${LESSON_END}'`);
  return bookingId;
}

/** Record one poll per minute from `fromMin` to `toMin` (inclusive) after the start. */
async function pollMinutes(
  bookingId: string,
  fromMin: number,
  toMin: number,
  who: { customer: boolean; provider: boolean },
  ok = true,
) {
  await asServiceRole(db, async () => {
    for (let m = fromMin; m <= toMin; m++) {
      await db.query(
        `SELECT public.record_online_session_presence(
           $1::uuid, timestamptz '${LESSON_START}' + ($2::int * interval '1 minute'), $3, $4, $5)`,
        [bookingId, m, ok, who.customer, who.provider],
      );
    }
  });
}

async function webhook(
  bookingId: string,
  type: "participant_joined" | "participant_left",
  participant: "customer" | "provider",
  minuteAfterStart: number,
) {
  await asServiceRole(db, () =>
    db.query(
      `SELECT public.apply_livekit_session_webhook_event(
         $1, $2::uuid, $3, $4, timestamptz '${LESSON_START}' + ($5::int * interval '1 minute'))`,
      [randomUUID(), bookingId, type, participant, minuteAfterStart],
    ),
  );
}

async function resolveSessions() {
  await asServiceRole(db, () =>
    queryRows(db, "SELECT public.resolve_online_session_bookings()::int AS n"),
  );
}

async function bookingRow(bookingId: string) {
  const rows = await queryRows<{ status: string; outcome: string | null }>(
    db,
    `SELECT status::text AS status, online_session_outcome AS outcome
     FROM public.bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0]!;
}

async function events(bookingId: string) {
  return queryRows<{ participant: string; joined_min: number; left_min: number | null; source: string }>(
    db,
    `SELECT participant,
            (EXTRACT(epoch FROM (joined_at - timestamptz '${LESSON_START}')) / 60)::int AS joined_min,
            (EXTRACT(epoch FROM (left_at - timestamptz '${LESSON_START}')) / 60)::int AS left_min,
            source
     FROM public.session_events WHERE booking_id = $1
     ORDER BY participant, joined_at`,
    [bookingId],
  );
}

async function walletRefunds(bookingId: string) {
  const rows = await queryRows<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM public.customer_wallet_entries
     WHERE booking_id = $1 AND reason = 'online_no_show_refund'`,
    [bookingId],
  );
  return Number(rows[0]!.n);
}

async function openReviews(bookingId: string) {
  const rows = await queryRows<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM public.online_session_admin_reviews
     WHERE booking_id = $1 AND status = 'open'`,
    [bookingId],
  );
  return Number(rows[0]!.n);
}

describe("presence poller records attendance", () => {
  it("opens one poll row per participant and closes it when they leave", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 40, { customer: true, provider: true });
    await pollMinutes(bookingId, 41, 60, { customer: false, provider: true });

    const rows = await events(bookingId);
    expect(rows).toEqual([
      { participant: "customer", joined_min: 0, left_min: 41, source: "poll" },
      { participant: "provider", joined_min: 0, left_min: null, source: "poll" },
    ]);
  });

  it("a failed poll never opens or closes attendance", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 2, { customer: true, provider: false });
    await pollMinutes(bookingId, 3, 5, { customer: false, provider: false }, false);
    const rows = await events(bookingId);
    expect(rows).toEqual([{ participant: "customer", joined_min: 0, left_min: null, source: "poll" }]);
    const polls = await queryRows<{ ok: boolean; n: string }>(
      db,
      "SELECT ok, count(*)::text AS n FROM public.session_presence_polls WHERE booking_id = $1 GROUP BY ok ORDER BY ok",
      [bookingId],
    );
    expect(polls).toEqual([
      { ok: false, n: "3" },
      { ok: true, n: "3" },
    ]);
  });

  it("both present for the whole lesson: completed automatically, no review", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 60, { customer: true, provider: true });
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("complete");
    expect(row.status).toBe("completed");
    expect(await openReviews(bookingId)).toBe(0);
  });
});

describe("absences are settled only with evidence", () => {
  it("tutor present, student absent, full poll coverage: customer_absent is settled", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 60, { customer: false, provider: true });
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("customer_absent");
    expect(row.status).toBe("no_show");
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("nobody joined but polls covered the lesson: both_absent is settled", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 60, { customer: false, provider: false });
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("both_absent");
    expect(row.status).toBe("cancelled");
  });

  it("no attendance data at all: admin review, never a refund", async () => {
    const bookingId = await pastOnlineLesson();
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("admin_review_no_events");
    expect(row.status).toBe("confirmed");
    expect(await walletRefunds(bookingId)).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("poor poll coverage (poller down most of the lesson): review, not refund", async () => {
    const bookingId = await pastOnlineLesson();
    // Only 10 good polls for a 60-minute lesson: the student was seen, the tutor not.
    await pollMinutes(bookingId, 0, 9, { customer: true, provider: false });
    await pollMinutes(bookingId, 10, 60, { customer: false, provider: false }, false);
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("admin_review_no_events");
    expect(row.status).toBe("confirmed");
    expect(await walletRefunds(bookingId)).toBe(0);
    expect(await openReviews(bookingId)).toBe(1);
  });

  it("webhook events alone still count as evidence (old behaviour kept)", async () => {
    const bookingId = await pastOnlineLesson();
    await webhook(bookingId, "participant_joined", "customer", 0);
    await webhook(bookingId, "participant_left", "customer", 60);
    await resolveSessions();
    const row = await bookingRow(bookingId);
    expect(row.outcome).toBe("provider_absent");
    expect(row.status).toBe("no_show");
    expect(await openReviews(bookingId)).toBe(1);
  });
});

describe("webhook and poller are deduplicated", () => {
  it("a webhook join after the poller opened the row keeps one row with the earlier time", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 1, 5, { customer: false, provider: true });
    // Webhook arrives late but reports the real join time (minute 0).
    await webhook(bookingId, "participant_joined", "provider", 0);
    let rows = await events(bookingId);
    expect(rows).toEqual([{ participant: "provider", joined_min: 0, left_min: null, source: "webhook" }]);

    // The poller sees the tutor leave at minute 30, then the webhook "left" arrives.
    await pollMinutes(bookingId, 30, 30, { customer: false, provider: false });
    await webhook(bookingId, "participant_left", "provider", 29);
    rows = await events(bookingId);
    expect(rows.filter((r) => r.participant === "provider" && r.left_min !== r.joined_min)).toEqual([
      { participant: "provider", joined_min: 0, left_min: 30, source: "webhook" },
    ]);
  });

  it("a webhook join while a row is open never fails on the one-open-row index", async () => {
    const bookingId = await pastOnlineLesson();
    await pollMinutes(bookingId, 0, 3, { customer: true, provider: false });
    await expect(webhook(bookingId, "participant_joined", "customer", 2)).resolves.toBeUndefined();
    const open = await queryRows<{ n: string }>(
      db,
      "SELECT count(*)::text AS n FROM public.session_events WHERE booking_id = $1 AND left_at IS NULL",
      [bookingId],
    );
    expect(open[0]?.n).toBe("1");
  });
});

describe("poll invocation and access", () => {
  it("invokes the website only during an active lesson, with a single-use ticket", async () => {
    await db.exec("DELETE FROM net._http_journal");
    // No active lesson right now (the others ended in the past): nothing is sent.
    await asServiceRole(db, () => db.query("SELECT public.famy_invoke_online_presence_poll()"));
    let calls = await queryRows<{ n: string }>(
      db,
      "SELECT count(*)::text AS n FROM net._http_journal WHERE url LIKE '%/api/online-sessions/presence-poll'",
    );
    expect(calls[0]?.n).toBe("0");

    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await makeOnline(bookingId, "now() - interval '5 minutes'", "now() + interval '55 minutes'");
    await asServiceRole(db, () => db.query("SELECT public.famy_invoke_online_presence_poll()"));
    calls = await queryRows<{ n: string }>(
      db,
      "SELECT count(*)::text AS n FROM net._http_journal WHERE url LIKE '%/api/online-sessions/presence-poll'",
    );
    expect(calls[0]?.n).toBe("1");

    const active = await asServiceRole(db, () =>
      queryRows<{ id: string }>(db, "SELECT public.online_presence_active_bookings() AS id"),
    );
    expect(active.map((r) => r.id)).toContain(bookingId);

    const ticket = await queryRows<{ id: string }>(
      db,
      "SELECT id::text FROM public.online_presence_poll_tickets ORDER BY created_at DESC LIMIT 1",
    );
    const first = await asServiceRole(db, () =>
      queryRows<{ ok: boolean }>(db, "SELECT public.claim_online_presence_poll_ticket($1::uuid) AS ok", [
        ticket[0]!.id,
      ]),
    );
    const second = await asServiceRole(db, () =>
      queryRows<{ ok: boolean }>(db, "SELECT public.claim_online_presence_poll_ticket($1::uuid) AS ok", [
        ticket[0]!.id,
      ]),
    );
    expect(first[0]?.ok).toBe(true);
    expect(second[0]?.ok).toBe(false);
  });

  it("only the server can run the poller functions", async () => {
    const bookingId = await pastOnlineLesson();
    const calls = [
      `SELECT public.record_online_session_presence('${bookingId}'::uuid, now(), true, true, true)`,
      `SELECT public.claim_online_presence_poll_ticket('${randomUUID()}'::uuid)`,
      "SELECT public.famy_invoke_online_presence_poll()",
      "SELECT public.online_presence_active_bookings()",
      `SELECT public.online_session_presence_evidence_ok('${bookingId}'::uuid)`,
    ];
    for (const sql of calls) {
      expect((await tryAsAnon(db, sql)).ok).toBe(false);
      expect((await tryAsUser(db, IDS.customer, sql)).ok).toBe(false);
    }
    const tickets = await tryAsUser(db, IDS.customer, "SELECT count(*) FROM public.online_presence_poll_tickets");
    expect(tickets.ok).toBe(false);
  });
});
