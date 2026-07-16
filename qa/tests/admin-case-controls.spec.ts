import { test, expect } from "@playwright/test";
import path from "path";
import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { captureErrors } from "./helpers";

test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

test("dispute resolution and no-show rejection persist without booking side effects", async ({ page }) => {
  test.slow();
  const { readErrors } = captureErrors(page);
  const customer = readRegistry().users.find((user: any) => user.key === "customer");
  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from("bookings")
    .select("id,status")
    .eq("status", "cancelled")
    .ilike("notes", "QA_%")
    .limit(10);
  expect(bookingsError).toBeNull();
  const bookingIds = (bookings ?? []).map((booking) => booking.id);
  const { data: existingDisputes, error: existingDisputesError } = await supabaseAdmin
    .from("disputes")
    .select("booking_id")
    .in("booking_id", bookingIds)
    .in("status", ["open", "info_requested"]);
  const { data: existingNoShows, error: existingNoShowsError } = await supabaseAdmin
    .from("no_show_reports")
    .select("booking_id")
    .in("booking_id", bookingIds)
    .in("status", ["open", "info_requested"]);
  expect(existingDisputesError).toBeNull();
  expect(existingNoShowsError).toBeNull();
  const occupiedBookingIds = new Set([
    ...(existingDisputes ?? []).map((row) => row.booking_id),
    ...(existingNoShows ?? []).map((row) => row.booking_id),
  ]);
  const booking = (bookings ?? []).find((candidate) => !occupiedBookingIds.has(candidate.id));
  expect(booking, "an unoccupied QA cancelled booking is required for case controls").toBeTruthy();
  const { data: dispute, error: disputeError } = await supabaseAdmin.from("disputes").insert({
    booking_id: booking!.id,
    opened_by: customer.userId,
    opened_by_role: "customer",
    previous_status: booking!.status,
    reason: "QA_ dispute review",
    description: "QA_ dispute fixture",
    evidence_paths: [],
    status: "open",
  }).select().single();
  expect(disputeError).toBeNull();
  const { data: noShow, error: noShowError } = await supabaseAdmin.from("no_show_reports").insert({
    booking_id: booking!.id,
    reported_by: customer.userId,
    reporter_role: "customer",
    reported_party: "provider",
    previous_status: booking!.status,
    reason: "QA_ no-show review",
    evidence_paths: [],
    status: "open",
  }).select().single();
  expect(noShowError).toBeNull();

  await page.goto("/admin/cases");
  await page.getByRole("button", { name: /disputes/i }).click();
  let row = page.getByRole("listitem").filter({ hasText: dispute!.id });
  await row.getByRole("button", { name: /view details/i }).click();
  const resolve = row.getByRole("button", { name: /^resolve$/i });
  await expect(resolve).toBeDisabled();
  await row.getByLabel(/admin notes/i).fill("QA_ dispute resolved safely");
  const [disputeResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_resolve_dispute") && response.request().method() === "POST"),
    resolve.click(),
  ]);
  expect(disputeResponse.ok(), `dispute resolution should succeed: ${disputeResponse.status()} ${await disputeResponse.text().catch(() => "")}`).toBe(true);
  await expect(row).toContainText(/resolved/i);
  await page.reload();
  const { data: storedDispute } = await supabaseAdmin.from("disputes").select("status,admin_notes,resolved_at").eq("id", dispute!.id).single();
  expect(storedDispute).toMatchObject({ status: "resolved", admin_notes: "QA_ dispute resolved safely" });
  expect(storedDispute!.resolved_at).toBeTruthy();

  await page.getByRole("button", { name: /no-show reports/i }).click();
  row = page.getByRole("listitem").filter({ hasText: noShow!.id });
  await row.getByRole("button", { name: /view details/i }).click();
  const reject = row.getByRole("button", { name: /^reject$/i });
  await expect(reject).toBeDisabled();
  await row.getByLabel(/admin notes/i).fill("QA_ no-show rejected safely");
  const [noShowResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rpc/admin_resolve_no_show") && response.request().method() === "POST"),
    reject.click(),
  ]);
  expect(noShowResponse.ok(), `no-show rejection should succeed: ${noShowResponse.status()} ${await noShowResponse.text().catch(() => "")}`).toBe(true);
  await expect(row).toContainText(/rejected/i);
  await page.reload();
  const { data: storedNoShow } = await supabaseAdmin.from("no_show_reports").select("status,admin_notes,resolved_at").eq("id", noShow!.id).single();
  expect(storedNoShow).toMatchObject({ status: "rejected", admin_notes: "QA_ no-show rejected safely" });
  expect(storedNoShow!.resolved_at).toBeTruthy();

  const { data: unchangedBooking } = await supabaseAdmin.from("bookings").select("status").eq("id", booking!.id).single();
  expect(unchangedBooking!.status).toBe("cancelled");
  const { count: disputeAudit } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "disputes").eq("entity_id", dispute!.id).eq("action", "UPDATE");
  const { count: noShowAudit } = await supabaseAdmin.from("audit_logs").select("id", { head: true, count: "exact" }).eq("entity", "no_show_reports").eq("entity_id", noShow!.id).eq("action", "UPDATE");
  expect(disputeAudit).toBe(1);
  expect(noShowAudit).toBe(1);
  const errors = readErrors();
  expect(errors.console).toEqual([]);
  expect(errors.network.filter((entry) => !entry.includes("favicon"))).toEqual([]);

  await supabaseAdmin.from("disputes").delete().eq("id", dispute!.id);
  await supabaseAdmin.from("no_show_reports").delete().eq("id", noShow!.id);
});
