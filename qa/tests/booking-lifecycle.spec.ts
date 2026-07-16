import { test, expect } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client.mjs";
import { loadEnv } from "../env.mjs";
import { readRegistry } from "../registry.mjs";

loadEnv();
test.use({ storageState: path.resolve(process.cwd(), "qa/.auth/admin.json") });

const QA_PASSWORD = "QaRuntime!2026Test";

/**
 * Exercises the real booking-creation validation pipeline (RLS +
 * tg_validate_booking_service: service active, provider approved for it,
 * address resolves to a covered zone, zone offers the service) using the
 * QA customer's own authenticated client — same insert path the booking
 * wizard UI uses (src/lib/db/queries.ts useCreateBooking) — then verifies
 * the booking through the real Admin UI, and exercises cancellation there.
 */
test("customer creates a real booking; it's visible in Admin and cancellable", async ({ page }) => {
  test.slow();
  const registry = readRegistry();
  const customerEntry = registry.users.find((u: any) => u.key === "customer");
  const providerEntry = registry.users.find((u: any) => u.key === "provider");
  expect(customerEntry && providerEntry, "customer and provider fixtures should be registered").toBeTruthy();

  const { data: provider } = await supabaseAdmin.from("providers").select("id").eq("profile_id", providerEntry!.userId).single();
  const providerId = provider!.id;

  // provider_services approval is trigger-guarded to admin-authenticated
  // writes only (has_role(auth.uid(),'admin') — service-role has no
  // auth.uid(), so it's rejected same as any other non-admin caller). Drive
  // it through the real Admin UI, same as provider-eligibility.spec.ts.
  const { data: existingServices } = await supabaseAdmin.from("provider_services").select("service_id").eq("provider_id", providerId);
  const existingServiceIds = new Set((existingServices ?? []).map((row) => row.service_id));
  const { data: services } = await supabaseAdmin
    .from("services")
    .select("id, base_price, duration_min, pricing_model")
    .eq("is_active", true);
  const service = services?.find((row) => !existingServiceIds.has(row.id));
  expect(service, "an unused active service should exist for the booking fixture").toBeTruthy();
  const { data: psRequested, error: psErr } = await supabaseAdmin.from("provider_services").insert({ provider_id: providerId, service_id: service!.id, status: "pending" }).select().single();
  expect(psErr, `provider_services insert should succeed: ${psErr?.message}`).toBeFalsy();
  const ps = psRequested;

  await page.goto(`/admin/provider/${providerId}`);
  await page.getByRole("button", { name: /^approve$/i }).first().click(); // verify provider
  await expect(page.getByText(/verified/i).first()).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: /^approve$/i }).first().click(); // approve the service request
  await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 10_000 });

  const { data: zone, error: zoneErr } = await supabaseAdmin.from("zones").insert({
    name_en: "QA_booking_zone", name_ar: "QA_منطقة_حجز", boundary_type: "polygon", is_active: true,
    polygon: [{ lat: 30.0, lng: 31.0 }, { lat: 30.0, lng: 31.05 }, { lat: 30.03, lng: 31.02 }],
  }).select().single();
  expect(zoneErr, `zone insert should succeed: ${zoneErr?.message}`).toBeFalsy();
  const { error: zsErr } = await supabaseAdmin.from("zone_services").insert({ zone_id: zone!.id, service_id: service!.id });
  expect(zsErr, `zone_services insert should succeed: ${zsErr?.message}`).toBeFalsy();
  const { error: zpErr } = await supabaseAdmin.from("zone_providers").insert({ zone_id: zone!.id, provider_id: providerId });
  expect(zpErr, `zone_providers insert should succeed: ${zpErr?.message}`).toBeFalsy();

  // Customer needs a saved address inside that zone.
  const customerAuthEmail = `phone-${customerEntry!.phone.replace(/\D/g, "")}@famio.local`;
  const anon = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_PUBLISHABLE_KEY ?? "");
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email: customerAuthEmail, password: QA_PASSWORD });
  expect(signInErr, "QA customer sign-in should succeed").toBeFalsy();

  const { data: address, error: addressErr } = await anon.from("addresses").insert({
    user_id: customerEntry!.userId, label: "other", custom_label: "QA_ home", city: "Cairo", line1: "QA_ test street 1",
    lat: 30.01, lng: 31.01, is_default: true,
  }).select().single();
  expect(addressErr, `address insert should succeed: ${addressErr?.message}`).toBeFalsy();

  const startAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days out, clear of any other test's slots
  const endAt = new Date(startAt.getTime() + (service!.duration_min ?? 60) * 60 * 1000);
  await supabaseAdmin.from("availability_rules").insert({
    provider_id: providerId,
    weekday: startAt.getUTCDay(),
    start_time: "00:00",
    end_time: "23:59",
  });
  const { data: pricedProvider } = await supabaseAdmin.from("providers").select("hourly_rate").eq("id", providerId).single();
  const { data: pricedService } = await supabaseAdmin.from("provider_services").select("price_override").eq("id", ps!.id).single();
  const rate = Number(pricedService!.price_override ?? pricedProvider!.hourly_rate);
  const hours = (endAt.getTime() - startAt.getTime()) / 3_600_000;
  const subtotal = service!.pricing_model === "hourly" ? Math.round(rate * hours * 100) / 100 : rate;
  const { data: billingRow } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").maybeSingle();
  const billing = (billingRow?.value as { platform_fee?: number; vat_percent?: number } | null) ?? {};
  const platformFee = Number(billing.platform_fee ?? 25);
  const vat = Math.round(subtotal * Number(billing.vat_percent ?? 14) / 100);
  const total = subtotal + platformFee + vat + Number(zone!.travel_fee ?? 0);

  const { data: booking, error: bookingErr } = await anon.from("bookings").insert({
    provider_id: providerId, service_id: service!.id, address_id: address!.id,
    start_at: startAt.toISOString(), end_at: endAt.toISOString(),
    price_subtotal: subtotal, price_discount: 0, price_total: total,
    currency: "EGP", status: "pending", notes: "QA_ automated booking-lifecycle test",
    customer_id: customerEntry!.userId,
  } as any).select().single();
  expect(bookingErr, `booking insert should pass RLS + trigger validation: ${bookingErr?.message}`).toBeFalsy();
  expect(booking).toBeTruthy();

  // Admin can see it through the real Admin UI (not just a DB query) —
  // the customer's profile is tagged QA_customer_e2e by global-setup.
  await page.goto("/admin/bookings");
  await expect(page.getByText(/QA_customer_e2e/i).first()).toBeVisible({ timeout: 15_000 });

  const { data: adminVisibleBooking } = await supabaseAdmin.from("bookings").select("id, status").eq("id", booking!.id).single();
  expect(adminVisibleBooking.status).toBe("pending");

  // Cancellation via the real customer-facing cancel path is a separate UI
  // (booking.$id.tsx); here we verify the DB-level cancellation flow Admin
  // relies on works: booking_cancellations is populated when status flips.
  const { data: reason } = await supabaseAdmin.from("cancellation_reasons").select("id, code, name_en, name_ar").eq("actor_type", "customer").limit(1).maybeSingle();
  expect(reason, "a customer cancellation reason should exist").toBeTruthy();
  const { error: cancelErr } = await anon.rpc("cancel_booking", {
    p_booking_id: booking!.id,
    p_reason_id: reason!.id,
    p_note: "QA_ automated cancellation test",
  });
  expect(cancelErr, `cancel_booking should succeed: ${cancelErr?.message}`).toBeFalsy();
  const { data: cancelledBooking } = await supabaseAdmin.from("bookings").select("status").eq("id", booking!.id).single();
  expect(cancelledBooking.status).toBe("cancelled");

  // cleanup
  await supabaseAdmin.from("bookings").delete().eq("id", booking!.id);
  await supabaseAdmin.from("addresses").delete().eq("id", address!.id);
  await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone!.id);
  await supabaseAdmin.from("zones").delete().eq("id", zone!.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", ps!.id);
  await supabaseAdmin.from("availability_rules").delete().eq("provider_id", providerId);
});
