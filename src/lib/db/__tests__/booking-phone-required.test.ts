import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asServiceRole,
  createBookingLifecycleDb,
  IDS,
  seedLifecycleBooking,
} from "./booking-lifecycle.harness";

let db: PGlite;

beforeAll(async () => {
  db = await createBookingLifecycleDb();
  // First booking prepares the provider, address and customer fixtures.
  await seedLifecycleBooking(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("booking_requires_customer_phone", () => {
  it("rejects a booking when the customer has no phone, and allows it once added", async () => {
    await asServiceRole(db, () =>
      db.exec(`UPDATE public.profiles SET phone = NULL WHERE id = '${IDS.customer}'`),
    );
    await expect(seedLifecycleBooking(db)).rejects.toThrow(/BOOKING_PHONE_REQUIRED/);

    await asServiceRole(db, () =>
      db.exec(`UPDATE public.profiles SET phone = '01022223333' WHERE id = '${IDS.customer}'`),
    );
    const { bookingId } = await seedLifecycleBooking(db);
    expect(bookingId).toBeTruthy();
  });
});
