import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";

const DEFAULT_CUSTOMER_COORDS = { lat: 30.01, lng: 31.02 };
const FIXTURE_ADDRESS_COORDS = { lat: 30.02, lng: 31.015 };

export async function deactivateCompetingPolygonZones(lat, lng, keepZoneId) {
  const deactivatedZoneIds = [];
  const { data: zones, error } = await supabaseAdmin.from("zones")
    .select("id, polygon")
    .eq("is_active", true)
    .eq("boundary_type", "polygon");
  if (error) throw error;

  for (const zone of zones ?? []) {
    if (zone.id === keepZoneId) continue;
    const { data: inside, error: insideError } = await supabaseAdmin.rpc("point_in_polygon", {
      p_lat: lat,
      p_lng: lng,
      p_polygon: zone.polygon,
    });
    if (insideError) throw insideError;
    if (!inside) continue;
    const { error: deactivateError } = await supabaseAdmin.from("zones").update({ is_active: false }).eq("id", zone.id);
    if (deactivateError) throw deactivateError;
    deactivatedZoneIds.push(zone.id);
  }
  return deactivatedZoneIds;
}

export async function assertResolveZoneMatches(lat, lng, expectedZoneId) {
  const { data, error } = await supabaseAdmin.rpc("resolve_zone", { p_lat: lat, p_lng: lng });
  if (error) throw error;
  const resolvedZoneId = data?.[0]?.zone_id ?? null;
  if (resolvedZoneId !== expectedZoneId) {
    throw new Error(`resolve_zone returned ${resolvedZoneId ?? "null"}; expected exclusive fixture zone ${expectedZoneId}.`);
  }
}

export async function createEligibleMarketplaceFixture(suffix) {
  const registry = readRegistry();
  const providerUserReg = registry.users.find((u) => u.key === "provider");
  const { data: providerRow, error: providerError } = await supabaseAdmin.from("providers")
    .select("id, profile_id, is_verified, is_active, vacation_mode")
    .eq("profile_id", providerUserReg.userId)
    .single();
  if (providerError) throw providerError;

  const { data: lifecycleServices } = await supabaseAdmin.from("services").select("id").eq("slug", "qa-booking-lifecycle-v1");
  for (const lifecycleService of lifecycleServices ?? []) {
    await supabaseAdmin.from("provider_services").delete().eq("provider_id", providerRow.id).eq("service_id", lifecycleService.id);
    await supabaseAdmin.from("services").update({ is_active: false }).eq("id", lifecycleService.id);
  }

  const { data: category, error: categoryError } = await supabaseAdmin.from("categories").select("id").eq("is_active", true).limit(1).single();
  if (categoryError) throw categoryError;

  const serviceName = `QA_Patch2_Booking_${suffix}`;
  const zoneName = `QA_Patch2_BookingZone_${suffix}`;
  const evidencePath = `${providerUserReg.userId}/QA_booking_${suffix}.pdf`;
  const admin = authenticatedClient("admin");

  const { data: service, error: serviceError } = await supabaseAdmin.from("services").insert({
    category_id: category.id,
    slug: `qa-booking-${suffix}`,
    name_en: serviceName,
    name_ar: serviceName,
    pricing_model: "hourly",
    base_price: 100,
    minimum_price: 80,
    maximum_price: 120,
    provider_pricing_allowed: true,
    is_active: true,
  }).select().single();
  if (serviceError) throw serviceError;

  const { data: requirement, error: requirementError } = await supabaseAdmin.from("service_requirements").insert({
    service_id: service.id,
    code: `qa_booking_req_${suffix}`,
    name_en: `QA_Booking_Evidence_${suffix}`,
    name_ar: `QA_Booking_Evidence_${suffix}`,
    requirement_type: "certification",
    fulfillment_mode: "provider",
    required_for_provider_approval: true,
    required_during_booking: false,
    evidence_required: true,
    provider_extra_fee: 0,
    is_active: true,
    sort_order: 1,
  }).select().single();
  if (requirementError) throw requirementError;

  const upload = await supabaseAdmin.storage.from("provider-documents").upload(
    evidencePath,
    new TextEncoder().encode("%PDF-1.4\n% QA booking evidence\n%%EOF"),
    { contentType: "application/pdf" },
  );
  if (upload.error) throw upload.error;

  const { data: fulfillment, error: fulfillmentError } = await supabaseAdmin.from("provider_requirement_fulfillments").insert({
    provider_id: providerRow.id,
    requirement_id: requirement.id,
    status: "pending",
    evidence_storage_path: evidencePath,
    notes: "QA_ booking slot evidence",
  }).select().single();
  if (fulfillmentError) throw fulfillmentError;

  const { error: reviewError } = await admin
    .from("provider_requirement_fulfillments")
    .update({ status: "passed" })
    .eq("id", fulfillment.id);
  if (reviewError) throw reviewError;

  const { data: providerService, error: providerServiceError } = await supabaseAdmin.from("provider_services").insert({
    provider_id: providerRow.id,
    service_id: service.id,
    status: "pending",
    price_override: 100,
  }).select().single();
  if (providerServiceError) throw providerServiceError;

  const { error: approvalError } = await admin.rpc("admin_set_provider_service_status", {
    p_id: providerService.id,
    p_status: "approved",
  });
  if (approvalError) throw approvalError;

  const { error: verificationError } = await admin.rpc("admin_set_provider_verification", {
    p_provider_id: providerRow.id,
    p_verified: true,
  });
  if (verificationError) throw verificationError;

  const { data: zone, error: zoneError } = await supabaseAdmin.from("zones").insert({
    name_en: zoneName,
    name_ar: zoneName,
    boundary_type: "polygon",
    is_active: true,
    polygon: [{ lat: 30.015, lng: 31.01 }, { lat: 30.015, lng: 31.03 }, { lat: 30.03, lng: 31.015 }],
    travel_fee: 0,
  }).select().single();
  if (zoneError) throw zoneError;

  const customer = registry.users.find((u) => u.key === "customer");
  const { data: priorAddress, error: priorAddressError } = await supabaseAdmin.from("addresses")
    .select("id, lat, lng")
    .eq("user_id", customer.userId)
    .eq("is_default", true)
    .single();
  if (priorAddressError) throw priorAddressError;

  const { error: addressSyncError } = await supabaseAdmin.from("addresses").update({
    lat: FIXTURE_ADDRESS_COORDS.lat,
    lng: FIXTURE_ADDRESS_COORDS.lng,
  }).eq("user_id", customer.userId).eq("is_default", true);
  if (addressSyncError) throw addressSyncError;

  const { error: zoneServiceError } = await supabaseAdmin.from("zone_services").insert({ zone_id: zone.id, service_id: service.id });
  if (zoneServiceError) throw zoneServiceError;
  const { error: zoneProviderError } = await supabaseAdmin.from("zone_providers").insert({ zone_id: zone.id, provider_id: providerRow.id });
  if (zoneProviderError) throw zoneProviderError;

  const deactivatedZoneIds = await deactivateCompetingPolygonZones(
    FIXTURE_ADDRESS_COORDS.lat,
    FIXTURE_ADDRESS_COORDS.lng,
    zone.id,
  );
  await assertResolveZoneMatches(FIXTURE_ADDRESS_COORDS.lat, FIXTURE_ADDRESS_COORDS.lng, zone.id);

  const { error: providerStateError } = await supabaseAdmin.from("providers").update({
    is_verified: true,
    is_active: true,
    vacation_mode: false,
  }).eq("id", providerRow.id);
  if (providerStateError) throw providerStateError;

  await supabaseAdmin.from("availability_rules").delete().eq("provider_id", providerRow.id);
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const { error } = await supabaseAdmin.from("availability_rules").insert({
      provider_id: providerRow.id,
      weekday,
      start_time: "08:00",
      end_time: "20:00",
    });
    if (error) throw error;
  }

  const { data: address, error: addressError } = await supabaseAdmin.from("addresses")
    .select("id")
    .eq("user_id", customer.userId)
    .eq("is_default", true)
    .single();
  if (addressError) throw addressError;

  const search = await authenticatedClient("customer").rpc("search_marketplace_providers", {
    p_service_id: service.id,
    p_address_id: address.id,
  });
  if (search.error) throw search.error;
  if (!(search.data ?? []).some((row) => row.id === providerRow.id)) {
    throw new Error("Fixture provider is not marketplace eligible for the QA customer address.");
  }

  const bookingSettings = await authenticatedClient("customer").rpc("marketplace_provider_booking_settings", {
    p_provider_id: providerRow.id,
    p_service_id: service.id,
    p_address_id: address.id,
  });
  if (bookingSettings.error) throw bookingSettings.error;
  if (!(bookingSettings.data ?? []).length) {
    throw new Error("Fixture provider booking settings RPC returned no rows.");
  }

  const { data: competingServices } = await supabaseAdmin.from("provider_services")
    .select("id")
    .eq("provider_id", providerRow.id)
    .neq("id", providerService.id);
  for (const row of competingServices ?? []) {
    await supabaseAdmin.from("provider_services").delete().eq("id", row.id);
  }

  return {
    provider: providerRow,
    service,
    requirement,
    fulfillment,
    providerService,
    zone,
    evidencePath,
    serviceName,
    zoneName,
    deactivatedZoneIds,
    priorAddressCoords: {
      lat: priorAddress.lat ?? DEFAULT_CUSTOMER_COORDS.lat,
      lng: priorAddress.lng ?? DEFAULT_CUSTOMER_COORDS.lng,
    },
    originalProviderState: {
      is_verified: providerRow.is_verified,
      is_active: providerRow.is_active,
      vacation_mode: providerRow.vacation_mode,
    },
  };
}

export async function cleanupEligibleMarketplaceFixture(fixture, bookingId) {
  if (bookingId) {
    await supabaseAdmin.from("bookings").update({ status: "cancelled", cancellation_reason: "QA_ booking slot cleanup" }).eq("id", bookingId);
    await supabaseAdmin.from("services").update({ is_active: false }).eq("id", fixture.service.id);
  } else {
    await supabaseAdmin.from("services").delete().eq("id", fixture.service.id);
  }
  await supabaseAdmin.from("zone_providers").delete().eq("zone_id", fixture.zone.id);
  await supabaseAdmin.from("zone_services").delete().eq("zone_id", fixture.zone.id);
  await supabaseAdmin.from("zones").delete().eq("id", fixture.zone.id);
  for (const zoneId of fixture.deactivatedZoneIds ?? []) {
    await supabaseAdmin.from("zones").update({ is_active: true }).eq("id", zoneId);
  }
  const registry = readRegistry();
  const customer = registry.users.find((u) => u.key === "customer");
  if (customer && fixture.priorAddressCoords) {
    await supabaseAdmin.from("addresses").update({
      lat: fixture.priorAddressCoords.lat,
      lng: fixture.priorAddressCoords.lng,
    }).eq("user_id", customer.userId).eq("is_default", true);
  }
  await supabaseAdmin.from("availability_rules").delete().eq("provider_id", fixture.provider.id);
  await supabaseAdmin.from("provider_requirement_fulfillments").delete().eq("id", fixture.fulfillment.id);
  await supabaseAdmin.from("provider_services").delete().eq("id", fixture.providerService.id);
  await supabaseAdmin.from("service_requirements").delete().eq("id", fixture.requirement.id);
  await supabaseAdmin.storage.from("provider-documents").remove([fixture.evidencePath]);
  await supabaseAdmin.from("providers").update(fixture.originalProviderState).eq("id", fixture.provider.id);
}
