import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  queryRows,
  seedLifecycleBooking,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("apply_livekit_session_webhook_event", () => {
  it("dedupes join events and allows retry before processed_at is set", async () => {
    const { bookingId } = await seedLifecycleBooking(db, { status: "in_progress" });
    const eventId = "evt-livekit-dedupe-1";

    const first = await asServiceRole(db, () =>
      db.query<{ apply_livekit_session_webhook_event: boolean }>(
        `SELECT public.apply_livekit_session_webhook_event($1, $2, 'participant_joined', 'customer', now()) AS apply_livekit_session_webhook_event`,
        [eventId, bookingId],
      ),
    );
    expect(first.rows[0]?.apply_livekit_session_webhook_event).toBe(true);

    const dup = await asServiceRole(db, () =>
      db.query<{ apply_livekit_session_webhook_event: boolean }>(
        `SELECT public.apply_livekit_session_webhook_event($1, $2, 'participant_joined', 'customer', now()) AS apply_livekit_session_webhook_event`,
        [eventId, bookingId],
      ),
    );
    expect(dup.rows[0]?.apply_livekit_session_webhook_event).toBe(false);

    const events = await queryRows<{ n: string }>(
      db,
      `SELECT count(*)::text AS n FROM public.session_events WHERE booking_id = $1 AND participant = 'customer'`,
      [bookingId],
    );
    expect(events[0]?.n).toBe("1");
  });
});