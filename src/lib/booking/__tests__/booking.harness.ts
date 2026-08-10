import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assertDirectInsertDenied,
  isPermissionDeniedError,
} from "@/lib/qa/behavioralSecurity";
import {
  IntegrationFixtureRegistry,
} from "@/lib/qa/integrationFixtureRegistry";
import { requireSeededCategory } from "@/lib/qa/seedCategory";
import { teardownRegisteredFixture } from "@/lib/qa/integrationFixtureTeardown";
import {
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/otp/__tests__/otpIntegration.harness";

export { isPermissionDeniedError, assertDirectInsertDenied };

export const FIXTURE_ADDRESS_COORDS = { lat: 30.02, lng: 31.015 };

export type BookingFixture = {
  registry: IntegrationFixtureRegistry;
  customerAId: string;
  customerBId: string;
  providerUserId: string;
  otherProviderUserId: string;
  adminUserId: string;
  providerId: string;
  otherProviderId: string;
  serviceId: string;
  zoneId: string;
  addressAId: string;
  addressBId: string;
  customerAClient: SupabaseClient<Database>;
  customerBClient: SupabaseClient<Database>;
  providerClient: SupabaseClient<Database>;
  otherProviderClient: SupabaseClient<Database>;
  adminClient: SupabaseClient<Database>;
};

export async function assertDirectBookingInsertDenied(
  admin: SupabaseClient<Database>,
  client: SupabaseClient<Database>,
  payload: Database["public"]["Tables"]["bookings"]["Insert"],
  scope: { customerId: string },
) {
  const { count: beforeCount, error: beforeCountError } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", scope.customerId);
  if (beforeCountError) throw beforeCountError;

  const { data, error } = await client.from("bookings").insert(payload).select("id");

  const { count: afterCount, error: afterCountError } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", scope.customerId);
  if (afterCountError) throw afterCountError;

  const verdict = assertDirectInsertDenied({
    error,
    data,
    rowCountBefore: beforeCount,
    rowCountAfter: afterCount,
  });
  if (!verdict.ok) {
    throw new Error(`direct booking INSERT behavioral assertion failed: ${verdict.reason}`);
  }
}

export async function createAuthedClient(
  email: string,
  password: string,
  anonKey: string,
): Promise<SupabaseClient<Database>> {
  const anon = createClient<Database>(supabaseUrl!, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return createClient<Database>(supabaseUrl!, anonKey, {
    global: { headers: { Authorization: `Bearer ${signIn!.session!.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function futureSlot(hoursFromNow = 72, durationHours = 2): { start: Date; end: Date } {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  return { start, end };
}

export async function assertProviderBookingEligibility(
  admin: SupabaseClient<Database>,
  providerId: string,
  serviceId: string,
  addressId: string,
): Promise<void> {
  const eligibility = await admin.rpc("marketplace_eligibility_internal", {
    p_provider_id: providerId,
    p_service_id: serviceId,
    p_address_id: addressId,
  });
  if (eligibility.error) throw eligibility.error;
  const eligible = (eligibility.data ?? []).some((row) => row.is_eligible);
  if (!eligible) {
    throw new Error(`BOOKING_PROVIDER_INELIGIBLE: ${JSON.stringify(eligibility.data)}`);
  }
}

async function approveProviderForBookingFixture(
  admin: SupabaseClient<Database>,
  adminClient: SupabaseClient<Database>,
  providerClient: SupabaseClient<Database>,
  registry: IntegrationFixtureRegistry,
  stamp: number,
  providerUserId: string,
  providerId: string,
  serviceId: string,
  zoneId: string,
) {
  await admin.from("profiles").update({
    avatar_url: `https://cdn.example/qa-booking-${providerUserId}.jpg`,
    full_name: "QA Booking Provider",
  }).eq("id", providerUserId);

  const sections = [
    ["personal", {
      legal_name: "QA Booking Provider",
      date_of_birth: "1990-01-01",
      gender: "female",
      governorate: "Cairo",
      area: "Maadi",
      full_address: "123 QA Booking Street",
    }],
    ["services", { service_ids: [serviceId] }],
    ["experience", { years_experience: 3, bio_en: "QA booking bio", bio_ar: "", languages: ["en"] }],
    ["coverage", { zone_ids: [zoneId] }],
    ["references", {
      references: [
        { full_name: "Ref One", relationship: "Friend", phone: "+201011122233" },
        { full_name: "Ref Two", relationship: "Neighbor", phone: "+201022233344" },
      ],
    }],
  ] as const;

  for (const [section, payload] of sections) {
    const saved = await providerClient.rpc("provider_save_onboarding_section", {
      p_section: section,
      p_payload: payload as never,
    });
    if (saved.error) throw saved.error;
  }

  for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
    await admin.from("provider_documents").delete().eq("provider_id", providerId).eq("type", type);
    const doc = await admin.from("provider_documents").insert({
      provider_id: providerId,
      type,
      storage_path: `${providerId}/${type}-${stamp}.pdf`,
      status: "pending",
    });
    if (doc.error) throw doc.error;
  }

  const review = await providerClient.rpc("provider_save_onboarding_section", {
    p_section: "review",
    p_payload: { confirmed: true },
  });
  if (review.error) throw review.error;

  const completion = await providerClient.rpc("provider_onboarding_completion", {
    p_provider_id: providerId,
  });
  if (completion.error) throw completion.error;
  if (!(completion.data as { complete?: boolean })?.complete) {
    throw new Error(`Provider onboarding incomplete: ${JSON.stringify(completion.data)}`);
  }

  const submit = await providerClient.rpc("provider_submit_onboarding");
  if (submit.error) throw submit.error;
  if (!(submit.data as { ok?: boolean })?.ok) {
    throw new Error(`provider_submit_onboarding failed: ${JSON.stringify(submit.data)}`);
  }

  const startReview = await adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: providerId,
    p_action: "start_review",
  });
  if (startReview.error) throw startReview.error;

  const { data: docs } = await admin.from("provider_documents")
    .select("id")
    .eq("provider_id", providerId);
  for (const doc of docs ?? []) {
    const reviewed = await adminClient.rpc("admin_review_provider_document", {
      p_document_id: doc.id,
      p_status: "approved",
    });
    if (reviewed.error) throw reviewed.error;
  }

  const approve = await adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: providerId,
    p_action: "approve",
  });
  if (approve.error) throw approve.error;

  const { data: approved } = await admin.from("providers")
    .select("onboarding_status, is_verified")
    .eq("id", providerId)
    .single();
  if (approved?.onboarding_status !== "APPROVED" || !approved?.is_verified) {
    throw new Error(`Provider approval failed: ${JSON.stringify(approved)}`);
  }

  const { data: providerService, error: psError } = await admin.from("provider_services")
    .select("id")
    .eq("provider_id", providerId)
    .eq("service_id", serviceId)
    .single();
  if (psError) throw psError;
  const serviceApproval = await adminClient.rpc("admin_set_provider_service_status", {
    p_id: providerService.id,
    p_status: "approved",
  });
  if (serviceApproval.error) throw serviceApproval.error;
  await admin.from("provider_services").update({ price_override: 100 }).eq("id", providerService.id);
  await admin.from("providers").update({ hourly_rate: 100, vacation_mode: false, is_active: true }).eq("id", providerId);
  registry.registerProviderService(providerId, serviceId);

  await admin.from("availability_rules").delete().eq("provider_id", providerId);
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await admin.from("availability_rules").insert({
      provider_id: providerId,
      weekday,
      start_time: "08:00",
      end_time: "20:00",
    });
  }
}

export async function seedEligibleBookingForAddressFixture(
  admin: SupabaseClient<Database>,
  registry: IntegrationFixtureRegistry,
  params: {
    stamp: number;
    customerId: string;
    addressId: string;
    customerClient: SupabaseClient<Database>;
    anonKey: string;
  },
): Promise<{ bookingId: string; providerId: string; serviceId: string; zoneId: string; providerUserId: string; adminClient: SupabaseClient<Database> }> {
  const providerEmail = `qa-address-provider-${params.stamp}@famio.local`;
  const adminEmail = `qa-address-booking-admin-${params.stamp}@famio.local`;
  const providerPassword = "QaAddressProv123!";
  const adminPassword = "QaAddressAdmin123!";

  const { data: providerAuth, error: providerAuthError } = await admin.auth.admin.createUser({
    email: providerEmail,
    password: providerPassword,
    email_confirm: true,
  });
  if (providerAuthError) throw providerAuthError;
  const providerUserId = providerAuth.user!.id;
  registry.registerUser(providerUserId, { email: providerEmail });
  registry.registerRole(providerUserId, "provider");
  await admin.from("user_roles").delete().eq("user_id", providerUserId).eq("role", "customer");
  await admin.from("user_roles").upsert({ user_id: providerUserId, role: "provider" });
  await admin.from("profiles").upsert({
    id: providerUserId,
    full_name: providerEmail,
    phone: `+2017${String(params.stamp).slice(-8)}`,
  });

  const { data: adminAuth, error: adminAuthError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (adminAuthError) throw adminAuthError;
  const adminUserId = adminAuth.user!.id;
  registry.registerUser(adminUserId, { email: adminEmail, admin: true });
  registry.registerRole(adminUserId, "admin");
  await admin.from("user_roles").upsert({ user_id: adminUserId, role: "admin" });
  await admin.from("profiles").upsert({
    id: adminUserId,
    full_name: adminEmail,
    phone: `+2016${String(params.stamp).slice(-8)}`,
  });

  const providerClient = await createAuthedClient(providerEmail, providerPassword, params.anonKey);
  const adminClient = await createAuthedClient(adminEmail, adminPassword, params.anonKey);

  const { data: started, error: startErr } = await providerClient.rpc("provider_start_onboarding");
  if (startErr) throw startErr;
  const providerId = (started as { id: string }).id;
  registry.registerProvider(providerId);

  const categoryId = await requireSeededCategory(admin, "home-cleaning");
  await admin.from("categories").update({ is_active: true }).eq("id", categoryId);

  const { data: zone, error: zoneError } = await admin.from("zones").insert({
    name_en: `QA Address Zone ${params.stamp}`,
    name_ar: `QA Address Zone ${params.stamp}`,
    boundary_type: "polygon",
    is_active: true,
    polygon: [{ lat: 30.015, lng: 31.01 }, { lat: 30.015, lng: 31.03 }, { lat: 30.03, lng: 31.015 }],
    travel_fee: 0,
  }).select("id").single();
  if (zoneError) throw zoneError;
  registry.registerZone(zone.id);

  const { data: service, error: serviceError } = await admin.from("services").insert({
    category_id: categoryId,
    slug: `qa-address-service-${params.stamp}`,
    name_en: `QA Address Service ${params.stamp}`,
    name_ar: `QA Address Service ${params.stamp}`,
    pricing_model: "hourly",
    base_price: 100,
    minimum_price: 80,
    maximum_price: 120,
    provider_pricing_allowed: true,
    is_active: true,
  }).select("id").single();
  if (serviceError) throw serviceError;
  registry.registerService(service.id);

  await admin.from("zone_services").insert({ zone_id: zone.id, service_id: service.id });
  await admin.from("zone_providers").insert({ zone_id: zone.id, provider_id: providerId });
  registry.registerZoneService(zone.id, service.id);
  registry.registerZoneProvider(zone.id, providerId);

  await approveProviderForBookingFixture(
    admin,
    adminClient,
    providerClient,
    registry,
    params.stamp,
    providerUserId,
    providerId,
    service.id,
    zone.id,
  );

  await admin.from("addresses").update({
    lat: FIXTURE_ADDRESS_COORDS.lat,
    lng: FIXTURE_ADDRESS_COORDS.lng,
    is_default: true,
  }).eq("id", params.addressId);

  const { data: competingZones } = await admin.from("zones")
    .select("id, polygon")
    .eq("is_active", true)
    .eq("boundary_type", "polygon")
    .neq("id", zone.id);
  for (const competing of competingZones ?? []) {
    const { data: inside } = await admin.rpc("point_in_polygon", {
      p_lat: FIXTURE_ADDRESS_COORDS.lat,
      p_lng: FIXTURE_ADDRESS_COORDS.lng,
      p_polygon: competing.polygon,
    });
    if (inside) {
      await admin.from("zones").update({ is_active: false }).eq("id", competing.id);
    }
  }

  await assertProviderBookingEligibility(admin, providerId, service.id, params.addressId);

  const { start, end } = futureSlot();
  const bookingResult = await rpcCreateBooking(params.customerClient, {
    provider_id: providerId,
    service_id: service.id,
    address_id: params.addressId,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    idempotency_key: randomUUID(),
    notes: `QA address iso booking ${params.stamp}`,
  });
  if (bookingResult.error) throw bookingResult.error;
  const bookingId = (bookingResult.data as { booking_id?: string; id?: string }).booking_id
    ?? (bookingResult.data as { id?: string }).id;
  if (!bookingId) {
    throw new Error(`create_booking returned no booking id: ${JSON.stringify(bookingResult.data)}`);
  }
  registry.registerBooking(bookingId);

  return {
    bookingId,
    providerId,
    serviceId: service.id,
    zoneId: zone.id,
    providerUserId,
    adminClient,
  };
}

export async function seedBookingFixture(
  admin: SupabaseClient<Database>,
  anonKey: string,
  registry = new IntegrationFixtureRegistry({ suite: "booking.integration" }),
): Promise<BookingFixture> {
  const stamp = Date.now();
  const customerAEmail = `qa-booking-a-${stamp}@famio.local`;
  const customerBEmail = `qa-booking-b-${stamp}@famio.local`;
  const providerEmail = `qa-booking-provider-${stamp}@famio.local`;
  const otherProviderEmail = `qa-booking-other-${stamp}@famio.local`;
  const adminEmail = `qa-booking-admin-${stamp}@famio.local`;

  let bookingRpcClient: SupabaseClient<Database> | undefined;
  try {
  async function createUser(
    email: string,
    password: string,
    role: "customer" | "provider" | "admin",
    phoneSuffix: string,
  ) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const userId = data.user!.id;
    registry.registerUser(userId, { email, admin: role === "admin" });
    registry.registerRole(userId, role);
    if (role === "provider") {
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "customer");
    }
    await admin.from("user_roles").upsert({ user_id: userId, role });
    await admin.from("profiles").upsert({
      id: userId,
      full_name: email,
      phone: `+2019${phoneSuffix.padStart(8, "0").slice(-8)}`,
    });
    return userId;
  }

  const customerAId = await createUser(customerAEmail, "QaBookingA123!", "customer", `${stamp}01`);
  const customerBId = await createUser(customerBEmail, "QaBookingB123!", "customer", `${stamp}02`);
  const providerUserId = await createUser(providerEmail, "QaBookingP123!", "provider", `${stamp}03`);
  const otherProviderUserId = await createUser(otherProviderEmail, "QaBookingO123!", "provider", `${stamp}04`);
  const adminUserId = await createUser(adminEmail, "QaBookingAdmin123!", "admin", `${stamp}05`);

  const customerAClient = await createAuthedClient(customerAEmail, "QaBookingA123!", anonKey);
  const customerBClient = await createAuthedClient(customerBEmail, "QaBookingB123!", anonKey);
  const providerClient = await createAuthedClient(providerEmail, "QaBookingP123!", anonKey);
  const otherProviderClient = await createAuthedClient(otherProviderEmail, "QaBookingO123!", anonKey);
  const adminClient = await createAuthedClient(adminEmail, "QaBookingAdmin123!", anonKey);
  bookingRpcClient = adminClient;

  const { data: started, error: startErr } = await providerClient.rpc("provider_start_onboarding");
  if (startErr) throw startErr;
  const providerId = (started as { id: string }).id;
  registry.registerProvider(providerId);
  const { data: otherStarted, error: otherStartErr } = await otherProviderClient.rpc("provider_start_onboarding");
  if (otherStartErr) throw otherStartErr;
  const otherProviderId = (otherStarted as { id: string }).id;
  registry.registerProvider(otherProviderId);

  let categoryId = await requireSeededCategory(admin, "home-cleaning");
  await admin.from("categories").update({ is_active: true }).eq("id", categoryId);

  const { data: zone, error: zoneError } = await admin.from("zones").insert({
    name_en: `QA Booking Zone ${stamp}`,
    name_ar: `QA Booking Zone ${stamp}`,
    boundary_type: "polygon",
    is_active: true,
    polygon: [{ lat: 30.015, lng: 31.01 }, { lat: 30.015, lng: 31.03 }, { lat: 30.03, lng: 31.015 }],
    travel_fee: 0,
  }).select("id").single();
  if (zoneError) throw zoneError;
  registry.registerZone(zone.id);

  const { data: service, error: serviceError } = await admin.from("services").insert({
    category_id: categoryId,
    slug: `qa-booking-service-${stamp}`,
    name_en: `QA Booking Service ${stamp}`,
    name_ar: `QA Booking Service ${stamp}`,
    pricing_model: "hourly",
    base_price: 100,
    minimum_price: 80,
    maximum_price: 120,
    provider_pricing_allowed: true,
    is_active: true,
  }).select("id").single();
  if (serviceError) throw serviceError;
  registry.registerService(service.id);

  await admin.from("zone_services").insert({ zone_id: zone.id, service_id: service.id });
  await admin.from("zone_providers").insert({ zone_id: zone.id, provider_id: providerId });
  registry.registerZoneService(zone.id, service.id);
  registry.registerZoneProvider(zone.id, providerId);
  registry.registerProviderService(providerId, service.id);

  async function approveProvider(
    client: SupabaseClient<Database>,
    targetProviderId: string,
    profileId: string,
  ) {
    await admin.from("profiles").update({
      avatar_url: `https://cdn.example/qa-booking-${profileId}.jpg`,
      full_name: "QA Booking Provider",
    }).eq("id", profileId);

    const sections = [
      ["personal", {
        legal_name: "QA Booking Provider",
        date_of_birth: "1990-01-01",
        gender: "female",
        governorate: "Cairo",
        area: "Maadi",
        full_address: "123 QA Booking Street",
      }],
      ["services", { service_ids: [service!.id] }],
      ["experience", { years_experience: 3, bio_en: "QA booking bio", bio_ar: "", languages: ["en"] }],
      ["coverage", { zone_ids: [zone!.id] }],
      ["references", {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "+201011122233" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "+201022233344" },
        ],
      }],
    ] as const;

    for (const [section, payload] of sections) {
      const saved = await client.rpc("provider_save_onboarding_section", {
        p_section: section,
        p_payload: payload as never,
      });
      if (saved.error) throw saved.error;
    }

    for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
      await admin.from("provider_documents").delete().eq("provider_id", targetProviderId).eq("type", type);
      const doc = await admin.from("provider_documents").insert({
        provider_id: targetProviderId,
        type,
        storage_path: `${targetProviderId}/${type}-${stamp}.pdf`,
        status: "pending",
      });
      if (doc.error) throw doc.error;
    }

    const review = await client.rpc("provider_save_onboarding_section", {
      p_section: "review",
      p_payload: { confirmed: true },
    });
    if (review.error) throw review.error;

    const completion = await client.rpc("provider_onboarding_completion", {
      p_provider_id: targetProviderId,
    });
    if (completion.error) throw completion.error;
    if (!(completion.data as { complete?: boolean })?.complete) {
      throw new Error(`Provider onboarding incomplete: ${JSON.stringify(completion.data)}`);
    }

    const submit = await client.rpc("provider_submit_onboarding");
    if (submit.error) throw submit.error;
    if (!(submit.data as { ok?: boolean })?.ok) {
      throw new Error(`provider_submit_onboarding failed: ${JSON.stringify(submit.data)}`);
    }

    const startReview = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: targetProviderId,
      p_action: "start_review",
    });
    if (startReview.error) throw startReview.error;

    const { data: docs } = await admin.from("provider_documents")
      .select("id")
      .eq("provider_id", targetProviderId);
    for (const doc of docs ?? []) {
      const reviewed = await adminClient.rpc("admin_review_provider_document", {
        p_document_id: doc.id,
        p_status: "approved",
      });
      if (reviewed.error) throw reviewed.error;
    }

    const approve = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: targetProviderId,
      p_action: "approve",
    });
    if (approve.error) throw approve.error;

    const { data: approved } = await admin.from("providers")
      .select("onboarding_status, is_verified")
      .eq("id", targetProviderId)
      .single();
    if (approved?.onboarding_status !== "APPROVED" || !approved?.is_verified) {
      throw new Error(`Provider approval failed: ${JSON.stringify(approved)}`);
    }
  }

  await approveProvider(providerClient, providerId, providerUserId);

  const { data: providerService, error: psError } = await admin.from("provider_services")
    .select("id")
    .eq("provider_id", providerId)
    .eq("service_id", service.id)
    .single();
  if (psError) throw psError;
  const serviceApproval = await adminClient.rpc("admin_set_provider_service_status", {
    p_id: providerService.id,
    p_status: "approved",
  });
  if (serviceApproval.error) throw serviceApproval.error;
  await admin.from("provider_services").update({ price_override: 100 }).eq("id", providerService.id);
  await admin.from("providers").update({ hourly_rate: 100, vacation_mode: false, is_active: true }).eq("id", providerId);

  await admin.from("availability_rules").delete().eq("provider_id", providerId);
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await admin.from("availability_rules").insert({
      provider_id: providerId,
      weekday,
      start_time: "08:00",
      end_time: "20:00",
    });
  }

  async function ensureAddress(userId: string, label: string) {
    const { data: existing } = await admin.from("addresses")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      await admin.from("addresses").update({
        lat: FIXTURE_ADDRESS_COORDS.lat,
        lng: FIXTURE_ADDRESS_COORDS.lng,
        is_default: true,
      }).eq("id", existing.id);
      return existing.id;
    }
    const { data: created, error } = await admin.from("addresses").insert({
      user_id: userId,
      label: "home",
      line1: label,
      area: "Maadi",
      city: "Cairo",
      is_default: true,
      lat: FIXTURE_ADDRESS_COORDS.lat,
      lng: FIXTURE_ADDRESS_COORDS.lng,
    }).select("id").single();
    if (error) throw error;
    return created.id;
  }

  const addressAId = await ensureAddress(customerAId, "QA Booking Address A");
  const addressBId = await ensureAddress(customerBId, "QA Booking Address B");
  registry.registerAddress(addressAId);
  registry.registerAddress(addressBId);

  const { data: competingZones } = await admin.from("zones")
    .select("id, polygon")
    .eq("is_active", true)
    .eq("boundary_type", "polygon")
    .neq("id", zone.id);
  for (const competing of competingZones ?? []) {
    const { data: inside } = await admin.rpc("point_in_polygon", {
      p_lat: FIXTURE_ADDRESS_COORDS.lat,
      p_lng: FIXTURE_ADDRESS_COORDS.lng,
      p_polygon: competing.polygon,
    });
    if (inside) {
      await admin.from("zones").update({ is_active: false }).eq("id", competing.id);
    }
  }

  await assertProviderBookingEligibility(admin, providerId, service.id, addressAId);

  return {
    registry,
    customerAId,
    customerBId,
    providerUserId,
    otherProviderUserId,
    adminUserId,
    providerId,
    otherProviderId,
    serviceId: service.id,
    zoneId: zone.id,
    addressAId,
    addressBId,
    customerAClient,
    customerBClient,
    providerClient,
    otherProviderClient,
    adminClient,
  };
  } catch (error) {
    await teardownRegisteredFixture(admin, registry, undefined, {
      bookingRpcClient: bookingRpcClient ?? undefined,
    });
    throw error;
  }
}

export async function cleanupBookingFixture(
  admin: SupabaseClient<Database>,
  fixture: BookingFixture,
  bookingIds: string[] = [],
) {
  for (const bookingId of bookingIds) {
    fixture.registry.registerBooking(bookingId);
  }
  await teardownRegisteredFixture(admin, fixture.registry, undefined, {
    bookingRpcClient: fixture.adminClient,
  });
}

export async function rpcCreateBooking(
  client: SupabaseClient<Database>,
  args: {
    provider_id: string;
    service_id: string;
    address_id: string;
    start_at: string;
    end_at: string;
    idempotency_key: string;
    family_member_id?: string | null;
    notes?: string | null;
    promo_code_id?: string | null;
    requirement_selections?: unknown;
  },
) {
  return client.rpc("create_booking", {
    p_provider_id: args.provider_id,
    p_service_id: args.service_id,
    p_address_id: args.address_id,
    p_start_at: args.start_at,
    p_end_at: args.end_at,
    p_idempotency_key: args.idempotency_key,
    p_family_member_id: args.family_member_id ?? undefined,
    p_notes: args.notes ?? undefined,
    p_promo_code_id: args.promo_code_id ?? undefined,
    p_requirement_selections: (args.requirement_selections ?? []) as never,
  });
}

export function probeCreateBookingRpc(admin: SupabaseClient<Database>) {
  return admin.rpc("create_booking", {
    p_provider_id: "00000000-0000-0000-0000-000000000000",
    p_service_id: "00000000-0000-0000-0000-000000000000",
    p_address_id: "00000000-0000-0000-0000-000000000000",
    p_start_at: new Date().toISOString(),
    p_end_at: new Date(Date.now() + 3_600_000).toISOString(),
    p_idempotency_key: "00000000-0000-0000-0000-000000000001",
  });
}

export { createOtpIntegrationClient, supabaseUrl };
