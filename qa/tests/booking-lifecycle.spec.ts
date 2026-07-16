import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("the proven QA booking lifecycle remains visible and cancelled", async ({ page }) => {
  const { data: booking, error } = await supabaseAdmin
    .from("bookings")
    .select("id, status, notes")
    .eq("notes", "QA_ automated booking-lifecycle test")
    .eq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  expect(error).toBeFalsy();
  expect(booking, "the retained immutable QA lifecycle record should exist").toBeTruthy();

  const { data: cancellations } = await supabaseAdmin
    .from("booking_cancellations")
    .select("id, note")
    .eq("booking_id", booking!.id);
  expect(cancellations).toHaveLength(1);
  expect(cancellations![0].note).toBe("QA_ automated cancellation test");

  const { data: history } = await supabaseAdmin
    .from("booking_status_history")
    .select("to_status")
    .eq("booking_id", booking!.id)
    .order("created_at");
  expect(history?.map((row) => row.to_status)).toEqual(["pending", "cancelled"]);

  await page.goto("/admin/bookings");
  await expect(page.getByText(booking!.id.slice(0, 8)).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText(booking!.id.slice(0, 8)).first()).toBeVisible({ timeout: 15_000 });
});
