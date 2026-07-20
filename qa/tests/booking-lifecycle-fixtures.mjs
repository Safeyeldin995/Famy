import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";

/** Deterministic markers owned exclusively by booking-lifecycle.spec.ts */
export const BOOKING_LIFECYCLE_NOTES = "QA_booking_lifecycle_v1";
export const BOOKING_LIFECYCLE_CANCELLATION_NOTE = "QA_booking_lifecycle_cancel_v1";
const SERVICE_NAME = "QA_booking_lifecycle_service_v1";
const ZONE_NAME = "QA_booking_lifecycle_zone_v1";
const ADDRESS_LABEL = "QA_booking_lifecycle_address_v1";

async function deleteFixtureBookings(customerId) {
  const { data: bookings, error } = await supabaseAdmin.from("bookings")
    .select("id, status")
    .eq("customer_id", customerId)
    .eq("notes", BOOKING_LIFECYCLE_NOTES);
  if (error) throw error;
  for (const row of bookings ?? []) {
    if (row.status === "cancelled") continue;
    const { error: deleteError } = await supabaseAdmin.from("bookings").delete().eq("id", row.id);
    if (deleteError && !`${deleteError.message}`.includes("violates foreign key")) throw deleteError;
  }
}

async function deleteFixtureService() {
  const { data: services } = await supabaseAdmin.from("services").select("id").eq("name_en", SERVICE_NAME);
  for (const service of services ?? []) {
    await supabaseAdmin.from("zone_services").delete().eq("service_id", service.id);
    const { data: providerServices } = await supabaseAdmin.from("provider_services").select("id").eq("service_id", service.id);
    for (const row of providerServices ?? []) {
      await supabaseAdmin.from("provider_services").delete().eq("id", row.id);
    }
    await supabaseAdmin.from("services").update({ is_active: false }).eq("id", service.id);
    const { error } = await supabaseAdmin.from("services").delete().eq("id", service.id);
    if (error && !`${error.message}`.includes("violates foreign key")) throw error;
  }
}

async function getOrCreateLifecycleService(categoryId) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("services")
    .select("id")
    .eq("slug", "qa-booking-lifecycle-v1")
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const { error: activateError } = await supabaseAdmin.from("services").update({ is_active: true }).eq("id", existing.id);
    if (activateError) throw activateError;
    return existing.id;
  }

  const { data: service, error: serviceError } = await supabaseAdmin.from("services").insert({
    category_id: categoryId,
    slug: "qa-booking-lifecycle-v1",
    name_en: SERVICE_NAME,
    name_ar: SERVICE_NAME,
    pricing_model: "hourly",
    base_price: 100,
    minimum_price: 80,
    maximum_price: 120,
    provider_pricing_allowed: true,
    is_active: true,
  }).select("id").single();
  if (serviceError) throw serviceError;
  return service.id;
}

async function deleteFixtureZones() {
  const { data: zones } = await supabaseAdmin.from("zones").select("id").eq("name_en", ZONE_NAME);
  for (const zone of zones ?? []) {
    await supabaseAdmin.from("zone_providers").delete().eq("zone_id", zone.id);
    await supabaseAdmin.from("zone_services").delete().eq("zone_id", zone.id);
    await supabaseAdmin.from("zones").delete().eq("id", zone.id);
  }
}

async function deleteFixtureAddresses(customerId) {
  await supabaseAdmin.from("addresses")
    .delete()
    .eq("user_id", customerId)
    .eq("custom_label", ADDRESS_LABEL);
}

async function findReusableFixtureBooking(customerId) {
  const { data: booking, error } = await supabaseAdmin.from("bookings")
    .select("id, status, notes, customer_id")
    .eq("customer_id", customerId)
    .eq("notes", BOOKING_LIFECYCLE_NOTES)
    .eq("status", "cancelled")
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;

  const { data: cancellations } = await supabaseAdmin
    .from("booking_cancellations")
    .select("note")
    .eq("booking_id", booking.id);
  if ((cancellations ?? []).length !== 1) return null;
  if (cancellations[0].note !== BOOKING_LIFECYCLE_CANCELLATION_NOTE) return null;

  const { data: history } = await supabaseAdmin
    .from("booking_status_history")
    .select("to_status")
    .eq("booking_id", booking.id)
    .order("created_at");
  if ((history ?? []).map((row) => row.to_status).join(",") !== "pending,cancelled") return null;

  return booking.id;
}

export async function cleanupBookingLifecycleFixture(handle) {
  if (!handle) return;

  if (handle.providerId && handle.providerSnapshot) {
    await supabaseAdmin.from("providers").update(handle.providerSnapshot).eq("id", handle.providerId);
  }
  if (handle.providerServiceId) {
    await supabaseAdmin.from("provider_services").delete().eq("id", handle.providerServiceId);
  }
  if (handle.availabilityRuleId) {
    await supabaseAdmin.from("availability_rules").delete().eq("id", handle.availabilityRuleId);
  }
  if (handle.zoneId) {
    await supabaseAdmin.from("zone_providers").delete().eq("zone_id", handle.zoneId);
    await supabaseAdmin.from("zone_services").delete().eq("zone_id", handle.zoneId);
    await supabaseAdmin.from("zones").delete().eq("id", handle.zoneId);
  }
  if (handle.serviceId) {
    await supabaseAdmin.from("zone_services").delete().eq("service_id", handle.serviceId);
    await supabaseAdmin.from("provider_services").delete().eq("service_id", handle.serviceId);
    await supabaseAdmin.from("services").update({ is_active: false }).eq("id", handle.serviceId);
    await supabaseAdmin.from("services").delete().eq("id", handle.serviceId);
  }
  if (handle.addressId) {
    await supabaseAdmin.from("addresses").delete().eq("id", handle.addressId);
  }
}

export async function ensureBookingLifecycleFixture() {
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  const providerUser = registry.users.find((u) => u.key === "provider");
  if (!customer || !providerUser) {
    throw new Error("QA registry is missing customer or provider identities.");
  }

  await deleteFixtureBookings(customer.userId);
  await deleteFixtureAddresses(customer.userId);
  await deleteFixtureZones();

  const reusableBookingId = await findReusableFixtureBooking(customer.userId);
  if (reusableBookingId) {
    return { bookingId: reusableBookingId, retained: true };
  }

  const { data: provider, error: providerLookupError } = await supabaseAdmin
    .from("providers")
    .select("id, is_active, is_verified, hourly_rate, max_advance_days, vacation_mode")
    .eq("profile_id", providerUser.userId)
    .single();
  if (providerLookupError) throw providerLookupError;
  const providerSnapshot = {
    is_active: provider.is_active,
    is_verified: provider.is_verified,
    hourly_rate: provider.hourly_rate,
    max_advance_days: provider.max_advance_days,
    vacation_mode: provider.vacation_mode,
  };

  let staged = {
    providerId: provider.id,
    providerSnapshot,
  };

  try {
    const { error: providerUpdateError } = await supabaseAdmin.from("providers").update({
      is_active: true,
      is_verified: true,
      hourly_rate: 100,
      max_advance_days: 365,
      vacation_mode: false,
    }).eq("id", provider.id);
    if (providerUpdateError) throw providerUpdateError;

    const { data: category, error: categoryError } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (categoryError) throw categoryError;

    const serviceId = await getOrCreateLifecycleService(category.id);
    staged.serviceId = serviceId;

    await supabaseAdmin.from("provider_services").delete().eq("provider_id", provider.id).eq("service_id", serviceId);
    const { data: providerService, error: providerServiceError } = await supabaseAdmin.from("provider_services").insert({
      provider_id: provider.id,
      service_id: serviceId,
      status: "pending",
      price_override: 100,
    }).select("id").single();
    if (providerServiceError) throw providerServiceError;
    staged.providerServiceId = providerService.id;

    const { error: approvalError } = await authenticatedClient("admin").rpc("admin_set_provider_service_status", {
      p_id: providerService.id,
      p_status: "approved",
    });
    if (approvalError) throw approvalError;

    const { data: zone, error: zoneError } = await supabaseAdmin.from("zones").insert({
      name_en: ZONE_NAME,
      name_ar: ZONE_NAME,
      boundary_type: "polygon",
      polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.05 }, { lat: 30.03, lng: 31.02 }],
      travel_fee: 0,
      is_active: true,
    }).select("id").single();
    if (zoneError) throw zoneError;
    staged.zoneId = zone.id;

    const { error: zoneServiceError } = await supabaseAdmin.from("zone_services").insert({
      zone_id: zone.id,
      service_id: serviceId,
    });
    if (zoneServiceError) throw zoneServiceError;

    const { error: zoneProviderError } = await supabaseAdmin.from("zone_providers").insert({
      zone_id: zone.id,
      provider_id: provider.id,
    });
    if (zoneProviderError) throw zoneProviderError;

    const { data: address, error: addressError } = await supabaseAdmin.from("addresses").insert({
      user_id: customer.userId,
      label: "other",
      custom_label: ADDRESS_LABEL,
      line1: ADDRESS_LABEL,
      city: "Sheikh Zayed",
      lat: 30.01,
      lng: 31.02,
    }).select("id").single();
    if (addressError) throw addressError;
    staged.addressId = address.id;

    const { data: billing } = await supabaseAdmin.from("settings").select("value").eq("key", "billing").single();
    const billingValue = billing?.value ?? {};
    const platformFee = Number(billingValue.platform_fee ?? 25);
    const vat = Math.round(100 * Number(billingValue.vat_percent ?? 14) / 100);
    const priceTotal = 100 + platformFee + vat;

    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    start.setUTCHours(10, 0, 0, 0);
    await supabaseAdmin.from("availability_rules").delete().eq("provider_id", provider.id).eq("weekday", start.getUTCDay());
    const { data: availabilityRule, error: availabilityError } = await supabaseAdmin.from("availability_rules").insert({
      provider_id: provider.id,
      weekday: start.getUTCDay(),
      start_time: "08:00",
      end_time: "20:00",
      timezone: "Africa/Cairo",
    }).select("id").single();
    if (availabilityError) throw availabilityError;
    staged.availabilityRuleId = availabilityRule.id;

    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings").insert({
      customer_id: customer.userId,
      address_id: address.id,
      provider_id: provider.id,
      service_id: serviceId,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      status: "pending",
      notes: BOOKING_LIFECYCLE_NOTES,
      price_subtotal: 100,
      price_total: priceTotal,
    }).select("id,status").single();
    if (bookingError) throw bookingError;

    const { data: reason, error: reasonError } = await supabaseAdmin
      .from("cancellation_reasons")
      .select("id")
      .eq("code", "admin_other")
      .eq("is_active", true)
      .single();
    if (reasonError) throw reasonError;

    const { data: cancellationId, error: cancelError } = await authenticatedClient("admin").rpc("cancel_booking", {
      p_booking_id: booking.id,
      p_reason_id: reason.id,
      p_note: BOOKING_LIFECYCLE_CANCELLATION_NOTE,
    });
    if (cancelError) throw cancelError;
    if (!cancellationId) throw new Error("cancel_booking returned no cancellation id.");

    return {
      bookingId: booking.id,
      retained: true,
      addressId: address.id,
      zoneId: zone.id,
      serviceId,
      providerId: provider.id,
      providerSnapshot,
      providerServiceId: providerService.id,
      availabilityRuleId: availabilityRule.id,
      cancellationId,
      customerId: customer.userId,
      providerUserId: providerUser.userId,
    };
  } catch (error) {
    await cleanupBookingLifecycleFixture(staged);
    throw error;
  }
}
