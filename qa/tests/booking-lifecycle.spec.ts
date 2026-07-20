import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import {
  BOOKING_LIFECYCLE_CANCELLATION_NOTE,
  BOOKING_LIFECYCLE_NOTES,
  cleanupBookingLifecycleFixture,
  ensureBookingLifecycleFixture,
} from "./booking-lifecycle-fixtures.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("the proven QA booking lifecycle remains visible and cancelled", async ({ page }) => {
  const registry = readRegistry();
  const customer = registry.users.find((user) => user.key === "customer");
  expect(customer, "QA customer identity is required").toBeTruthy();

  let fixture;
  try {
    fixture = await ensureBookingLifecycleFixture();

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("id, status, notes, customer_id")
      .eq("id", fixture.bookingId)
      .single();
    expect(error).toBeFalsy();
    expect(booking).toMatchObject({
      id: fixture.bookingId,
      status: "cancelled",
      notes: BOOKING_LIFECYCLE_NOTES,
      customer_id: customer!.userId,
    });

    const { data: cancellations } = await supabaseAdmin
      .from("booking_cancellations")
      .select("id, note")
      .eq("booking_id", fixture.bookingId);
    expect(cancellations).toHaveLength(1);
    expect(cancellations![0].note).toBe(BOOKING_LIFECYCLE_CANCELLATION_NOTE);

    const { data: history } = await supabaseAdmin
      .from("booking_status_history")
      .select("to_status")
      .eq("booking_id", fixture.bookingId)
      .order("created_at");
    expect(history?.map((row) => row.to_status)).toEqual(["pending", "cancelled"]);

    await page.goto("/admin/bookings");
    await expect(page.getByText(fixture.bookingId.slice(0, 8)).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText(fixture.bookingId.slice(0, 8)).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await cleanupBookingLifecycleFixture(fixture);
  }
});
