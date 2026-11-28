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
  await seedLifecycleBooking(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function asAnonRows<T extends Record<string, unknown>>(sql: string, params: unknown[]) {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    await db.exec("SET LOCAL ROLE anon");
    const res = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return res.rows;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

type Stats = {
  provider_id: string;
  is_verified: boolean;
  completed_bookings: number;
  completed_lessons: number;
  never_cancels: boolean | null;
  offers_online: boolean;
  offers_in_person: boolean;
};

async function stats(providerId = IDS.provider): Promise<Stats | undefined> {
  const rows = await asAnonRows<Stats>(
    `SELECT * FROM public.public_provider_trust_stats($1::uuid[])`,
    [[providerId]],
  );
  return rows[0];
}

/** Moves a seeded booking straight to a status without the lifecycle triggers. */
async function forceStatus(bookingId: string, status: string, extra = "") {
  await db.exec("SET session_replication_role = replica");
  try {
    await db.query(
      `UPDATE public.bookings SET status = $1::public.booking_status ${extra} WHERE id = $2`,
      [status, bookingId],
    );
  } finally {
    await db.exec("SET session_replication_role = DEFAULT");
  }
}

async function completedBookings(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { bookingId } = await seedLifecycleBooking(db, { status: "confirmed" });
    await forceStatus(bookingId, "completed");
    ids.push(bookingId);
  }
  return ids;
}

describe("public provider trust stats and reviews", () => {
  it("guests can read the stats; no badge claim without enough history", async () => {
    const s = await stats();
    expect(s).toBeDefined();
    expect(s!.never_cancels).toBeNull();
    expect(s!.completed_bookings).toBeGreaterThanOrEqual(0);
    expect(Object.keys(s!).sort()).toEqual(
      [
        "completed_bookings",
        "completed_lessons",
        "is_verified",
        "never_cancels",
        "offers_in_person",
        "offers_online",
        "provider_id",
      ].sort(),
    );
  });

  it("returns nothing for a provider that is not approved", async () => {
    const rows = await asAnonRows<Stats>(
      `SELECT * FROM public.public_provider_trust_stats($1::uuid[])`,
      [[IDS.otherProvider]],
    );
    const approved = await queryRows<{ ok: boolean }>(
      db,
      `SELECT onboarding_status = 'APPROVED' AS ok FROM public.providers WHERE id = $1`,
      [IDS.otherProvider],
    );
    if (!approved[0]?.ok) expect(rows).toHaveLength(0);
  });

  it("«never cancels» needs 10 completed bookings and turns off after a real cancellation", async () => {
    const before = (await stats())!.completed_bookings;
    await completedBookings(Math.max(0, 10 - before));
    expect((await stats())!.never_cancels).toBe(true);

    // Declining a pending request is not a cancellation.
    const declined = await seedLifecycleBooking(db, { status: "pending" });
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings SET status = 'cancelled', cancelled_by = $1, cancelled_at = now() WHERE id = $2`,
        [IDS.providerUser, declined.bookingId],
      ),
    );
    expect((await stats())!.never_cancels).toBe(true);

    // Cancelling after accepting is a strike.
    const accepted = await seedLifecycleBooking(db, { status: "confirmed" });
    await asServiceRole(db, () =>
      db.query(
        `UPDATE public.bookings SET status = 'cancelled', cancelled_by = $1, cancelled_at = now() WHERE id = $2`,
        [IDS.providerUser, accepted.bookingId],
      ),
    );
    expect((await stats())!.never_cancels).toBe(false);
  });

  it("reviews: guests read visible reviews with the lesson snapshot and the total, never the reviewer", async () => {
    const [b1, b2] = await completedBookings(2);
    await db.exec("SET session_replication_role = replica");
    try {
      await db.query(
        `UPDATE public.bookings SET teaching_level_name_ar = '3 ابتدائي', teaching_curriculum_name_ar = 'IB',
           teaching_subject_name_ar = 'فرنساوي' WHERE id = $1`,
        [b1],
      );
      await db.query(
        `INSERT INTO public.reviews (booking_id, customer_id, provider_id, rating, comment)
         VALUES ($1, $3, $4, 5, 'ممتازة'), ($2, $3, $4, 4, 'مخفي')`,
        [b1, b2, IDS.customer, IDS.provider],
      );
      await db.query(
        `UPDATE public.reviews SET moderation_hidden_at = now() WHERE booking_id = $1`,
        [b2],
      );
    } finally {
      await db.exec("SET session_replication_role = DEFAULT");
    }

    const rows = await asAnonRows<Record<string, unknown>>(
      `SELECT * FROM public.public_provider_reviews($1, 5, 0)`,
      [IDS.provider],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].comment).toBe("ممتازة");
    expect(rows[0].level_name_ar).toBe("3 ابتدائي");
    expect(rows[0].curriculum_name_ar).toBe("IB");
    expect(rows[0].subject_name_ar).toBe("فرنساوي");
    expect(rows[0].total_count).toBe(1);
    expect(rows[0]).not.toHaveProperty("customer_id");
    expect(rows[0]).not.toHaveProperty("booking_id");
  });

  it("caps the page size", async () => {
    const rows = await asAnonRows<Record<string, unknown>>(
      `SELECT count(*)::int AS n FROM public.public_provider_reviews($1, 100000, -5)`,
      [IDS.provider],
    );
    expect(Number(rows[0].n)).toBeLessThanOrEqual(50);
  });
});
