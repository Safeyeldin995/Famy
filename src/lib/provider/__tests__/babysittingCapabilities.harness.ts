import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { futureSlot, rpcCreateBooking } from "@/lib/booking/__tests__/booking.harness";
import {
  assertRunOwnedAdminsRemoved,
  teardownRegisteredFixture,
} from "@/lib/qa/integrationFixtureTeardown";
import {
  assertOwnerApprovedTeardown,
  buildBabysittingTeardownPlan,
  buildPendingTeardownRecord,
  containmentSnapshotFrom,
  DEFAULT_PENDING_TEARDOWN_PATH,
  persistPendingTeardown,
  PendingBabysittingTeardownError,
  type OwnerTeardownApproval,
  type PendingBabysittingTeardown,
} from "@/lib/qa/babysittingApprovedTeardown";
// @ts-expect-error — .mjs module has no generated declarations
import { buildBabysittingFixtureContainmentPlan } from "../../../../qa/containment-integration.mjs";
import {
  createAuthedClient,
  createRegisteredAuthUser,
  registerQaService,
  registerQaZone,
  requireSeededCategory,
  startRegisteredProvider,
  type ProviderHarnessContext,
} from "./providerOnboarding.harness";

export type { ProviderHarnessContext };

export { createAuthedClient, futureSlot, rpcCreateBooking, PendingBabysittingTeardownError };

function requireWrite(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function dryRunBabysittingTeardownPlan(
  ctx: ProviderHarnessContext,
  snapshot = ctx.registry.snapshot(),
) {
  const plan = await buildBabysittingFixtureContainmentPlan(
    ctx.admin,
    containmentSnapshotFrom(snapshot),
  );
  return buildBabysittingTeardownPlan(snapshot, plan);
}

/**
 * Stage 1: read-only dry-run. Persists pending fixture state. Zero teardown writes.
 * Residue remains active until a separately approved resume.
 */
export async function prepareBabysittingTeardownDryRun(
  ctx: ProviderHarnessContext,
  options?: { persistPath?: string; adminEmail?: string | null },
): Promise<PendingBabysittingTeardown> {
  const plan = await dryRunBabysittingTeardownPlan(ctx);
  const pending = buildPendingTeardownRecord(plan, { adminEmail: options?.adminEmail });
  persistPendingTeardown(pending, options?.persistPath ?? DEFAULT_PENDING_TEARDOWN_PATH);
  return pending;
}

/**
 * Stage 2: execute the owner-approved reviewed plan. Does not seed or recreate fixtures.
 * Always rebuilds the current dry-run (no currentPlan injection). Fail-closed on
 * missing/malformed/mismatched approval or a drifted current plan.
 */
export async function resumeApprovedBabysittingTeardown(
  ctx: ProviderHarnessContext,
  bookingRpcClient: SupabaseClient<Database> | undefined,
  approval: OwnerTeardownApproval,
) {
  assertOwnerApprovedTeardown({
    approval,
    currentPlan: approval?.plan,
  });
  const currentPlan = await dryRunBabysittingTeardownPlan(ctx, approval.plan.snapshot);
  assertOwnerApprovedTeardown({ approval, currentPlan });

  const approvedSnapshot = approval.plan.snapshot;
  if (approvedSnapshot.bookingIds.length > 0 && !bookingRpcClient) {
    throw new Error(
      "[qa-containment] babysitting fixture teardown requires bookingRpcClient before pending-booking cancel",
    );
  }

  await teardownRegisteredFixture(ctx.admin, ctx.registry, approvedSnapshot, {
    bookingRpcClient,
    approval: {
      snapshot: approvedSnapshot,
      containmentPlan: approval.plan.containment.plan as {
        fingerprint: string;
        actions?: Array<{ actionType: string }>;
      },
      expectedContainmentFingerprint: approval.plan.containment.fingerprint,
    },
  });
  await assertRunOwnedAdminsRemoved(ctx.admin, approvedSnapshot.adminUserIds);
}

/**
 * Mutating-suite afterAll: always dry-run + persist pending. Never auto-approves
 * the fingerprint just generated in this process.
 */
export async function cleanupBabysittingQaFixture(
  ctx: ProviderHarnessContext,
  _bookingRpcClient?: SupabaseClient<Database>,
  options?: { persistPath?: string; adminEmail?: string | null },
) {
  const pending = await prepareBabysittingTeardownDryRun(ctx, options);
  throw new PendingBabysittingTeardownError(pending);
}

export function monthsBeforeUtc(date: Date, months: number): string {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()),
  );
  return copy.toISOString().slice(0, 10);
}

export async function requireBabysittingCatalogue(admin: SupabaseClient<Database>) {
  const { data, error } = await admin
    .from("child_age_groups")
    .select("code, min_months, max_months, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) {
    throw new Error(
      `child_age_groups missing — apply 20260912090000 then 20260928081021 then 20260928093002 first: ${error.message}`,
    );
  }
  const codes = (data ?? []).map((row) => row.code);
  if (codes.join(",") !== "newborn,infant,toddler,preschool,school_age,teenager") {
    throw new Error(`Unexpected child_age_groups catalogue: ${JSON.stringify(data)}`);
  }
  const { error: maxError } = await admin
    .from("providers")
    .select("max_children_per_booking")
    .limit(1);
  if (maxError) {
    throw new Error(
      `providers.max_children_per_booking missing — apply Phase A first: ${maxError.message}`,
    );
  }
  const { error: capError } = await admin
    .from("provider_age_group_capabilities")
    .select("provider_id")
    .limit(1);
  if (capError) {
    throw new Error(
      `provider_age_group_capabilities missing — apply Phase A first: ${capError.message}`,
    );
  }
}

async function completeAndApproveProvider(
  ctx: ProviderHarnessContext,
  args: {
    stamp: number;
    providerUserId: string;
    providerId: string;
    providerClient: SupabaseClient<Database>;
    adminClient: SupabaseClient<Database>;
    serviceId: string;
    zoneId: string;
    babysitting: boolean;
  },
) {
  const profileUpdate = await ctx.admin
    .from("profiles")
    .update({
      avatar_url: `https://cdn.example/qa-babysit-${args.providerUserId}.jpg`,
      full_name: "QA Babysitting Provider",
    })
    .eq("id", args.providerUserId);
  requireWrite(profileUpdate.error, "profiles.update");

  const experience = args.babysitting
    ? {
        years_experience: 3,
        bio_en: "QA babysitting bio",
        bio_ar: "",
        languages: ["en"],
        max_children_per_booking: 2,
        age_group_capabilities: [{ code: "toddler", years_experience: 3 }],
      }
    : { years_experience: 3, bio_en: "QA cleaning bio", bio_ar: "", languages: ["en"] };

  const sections = [
    [
      "personal",
      {
        legal_name: "QA Babysitting Provider",
        date_of_birth: "1990-01-01",
        gender: "female",
        governorate: "Cairo",
        area: "Maadi",
        full_address: "123 QA Babysitting Street",
      },
    ],
    ["services", { service_ids: [args.serviceId] }],
    ["experience", experience],
    ["coverage", { zone_ids: [args.zoneId] }],
    [
      "references",
      {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "+201011122233" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "+201022233344" },
        ],
      },
    ],
  ] as const;

  for (const [section, payload] of sections) {
    const saved = await args.providerClient.rpc("provider_save_onboarding_section", {
      p_section: section,
      p_payload: payload as never,
    });
    if (saved.error) throw saved.error;
    if (section === "services") {
      ctx.registry.registerProviderService(args.providerId, args.serviceId);
    }
    if (section === "coverage") {
      ctx.registry.registerZoneProvider(args.zoneId, args.providerId);
    }
  }

  for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
    const removed = await ctx.admin
      .from("provider_documents")
      .delete()
      .eq("provider_id", args.providerId)
      .eq("type", type);
    requireWrite(removed.error, `provider_documents.delete:${type}`);
    const doc = await ctx.admin.from("provider_documents").insert({
      provider_id: args.providerId,
      type,
      storage_path: `${args.providerId}/${type}-${args.stamp}.pdf`,
      status: "pending",
    });
    if (doc.error) throw doc.error;
  }

  const review = await args.providerClient.rpc("provider_save_onboarding_section", {
    p_section: "review",
    p_payload: { confirmed: true },
  });
  if (review.error) throw review.error;

  const submit = await args.providerClient.rpc("provider_submit_onboarding");
  if (submit.error) throw submit.error;
  if (!(submit.data as { ok?: boolean })?.ok) {
    throw new Error(`provider_submit_onboarding failed: ${JSON.stringify(submit.data)}`);
  }

  const startReview = await args.adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: args.providerId,
    p_action: "start_review",
  });
  if (startReview.error) throw startReview.error;

  const docs = await ctx.admin
    .from("provider_documents")
    .select("id")
    .eq("provider_id", args.providerId);
  requireWrite(docs.error, "provider_documents.select");
  for (const doc of docs.data ?? []) {
    const reviewed = await args.adminClient.rpc("admin_review_provider_document", {
      p_document_id: doc.id,
      p_status: "approved",
    });
    if (reviewed.error) throw reviewed.error;
  }

  const approve = await args.adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: args.providerId,
    p_action: "approve",
  });
  if (approve.error) throw approve.error;

  const { data: providerService, error: psError } = await ctx.admin
    .from("provider_services")
    .select("id")
    .eq("provider_id", args.providerId)
    .eq("service_id", args.serviceId)
    .single();
  if (psError) throw psError;
  const serviceApproval = await args.adminClient.rpc("admin_set_provider_service_status", {
    p_id: providerService.id,
    p_status: "approved",
  });
  if (serviceApproval.error) throw serviceApproval.error;
  const priced = await ctx.admin
    .from("provider_services")
    .update({ price_override: 100 })
    .eq("id", providerService.id);
  requireWrite(priced.error, "provider_services.price_override");
  const rates = await ctx.admin
    .from("providers")
    .update({ hourly_rate: 100, vacation_mode: false, is_active: true })
    .eq("id", args.providerId);
  requireWrite(rates.error, "providers.hourly_rate");

  const clearedRules = await ctx.admin
    .from("availability_rules")
    .delete()
    .eq("provider_id", args.providerId);
  requireWrite(clearedRules.error, "availability_rules.delete");
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const rule = await ctx.admin.from("availability_rules").insert({
      provider_id: args.providerId,
      weekday,
      start_time: "08:00",
      end_time: "20:00",
    });
    requireWrite(rule.error, `availability_rules.insert:${weekday}`);
  }
}

export async function seedBabysittingQaFixture(ctx: ProviderHarnessContext) {
  const stamp = Date.now();
  const providerEmail = `qa-babysit-p-${stamp}@famio.local`;
  const adminEmail = `qa-babysit-a-${stamp}@famio.local`;
  const customerEmail = `qa-babysit-c-${stamp}@famio.local`;
  const otherEmail = `qa-babysit-o-${stamp}@famio.local`;
  const providerAdminEmail = `qa-babysit-pa-${stamp}@famio.local`;
  const cleaningEmail = `qa-babysit-cl-${stamp}@famio.local`;

  const providerUserId = await createRegisteredAuthUser(ctx, {
    email: providerEmail,
    password: "QaBabysitP123!",
    role: "provider",
    fullName: "QA Babysit Provider",
    phone: `+20110${stamp.toString().slice(-7)}`,
  });
  const adminUserId = await createRegisteredAuthUser(ctx, {
    email: adminEmail,
    password: "QaBabysitA123!",
    role: "admin",
    fullName: "QA Babysit Admin",
    phone: `+20111${stamp.toString().slice(-7)}`,
    admin: true,
  });
  const customerId = await createRegisteredAuthUser(ctx, {
    email: customerEmail,
    password: "QaBabysitC123!",
    role: "customer",
    fullName: "QA Babysit Customer",
    phone: `+20112${stamp.toString().slice(-7)}`,
  });
  const otherUserId = await createRegisteredAuthUser(ctx, {
    email: otherEmail,
    password: "QaBabysitO123!",
    role: "provider",
    fullName: "QA Other Provider",
    phone: `+20113${stamp.toString().slice(-7)}`,
  });
  const providerAdminUserId = await createRegisteredAuthUser(ctx, {
    email: providerAdminEmail,
    password: "QaBabysitPA123!",
    role: "provider",
    fullName: "QA Provider Admin",
    phone: `+20114${stamp.toString().slice(-7)}`,
    admin: true,
  });
  const providerAdminRole = await ctx.admin
    .from("user_roles")
    .upsert({ user_id: providerAdminUserId, role: "admin" });
  requireWrite(providerAdminRole.error, "user_roles.provider_admin");
  const cleaningUserId = await createRegisteredAuthUser(ctx, {
    email: cleaningEmail,
    password: "QaBabysitCL123!",
    role: "provider",
    fullName: "QA Cleaning Provider",
    phone: `+20115${stamp.toString().slice(-7)}`,
  });

  const providerClient = await createAuthedClient(providerEmail, "QaBabysitP123!", ctx.anonKey);
  const adminClient = await createAuthedClient(adminEmail, "QaBabysitA123!", ctx.anonKey);
  const customerClient = await createAuthedClient(customerEmail, "QaBabysitC123!", ctx.anonKey);
  const otherClient = await createAuthedClient(otherEmail, "QaBabysitO123!", ctx.anonKey);
  const providerAdminClient = await createAuthedClient(
    providerAdminEmail,
    "QaBabysitPA123!",
    ctx.anonKey,
  );
  const cleaningClient = await createAuthedClient(cleaningEmail, "QaBabysitCL123!", ctx.anonKey);

  const providerId = await startRegisteredProvider(ctx, providerClient);
  const otherProviderId = await startRegisteredProvider(ctx, otherClient);
  const providerAdminProviderId = await startRegisteredProvider(ctx, providerAdminClient);
  const cleaningProviderId = await startRegisteredProvider(ctx, cleaningClient);

  await requireSeededCategory(ctx.admin, "babysitting");
  const babysittingServiceId = await registerQaService(ctx, {
    slug: `qa-babysit-svc-${stamp}`,
    name: `QA_ babysitting ${stamp}`,
    categorySlug: "babysitting",
  });
  const cleaningServiceId = await registerQaService(ctx, {
    slug: `qa-babysit-clean-${stamp}`,
    name: `QA_ cleaning ${stamp}`,
    categorySlug: "home-cleaning",
  });
  const isolated = { lat: 1.001, lng: 1.001 };
  const zoneId = await registerQaZone(ctx, { name: `QA_ babysit zone ${stamp}` });
  const zoneShape = await ctx.admin
    .from("zones")
    .update({
      polygon: [
        { lat: 1.0, lng: 1.0 },
        { lat: 1.0, lng: 1.02 },
        { lat: 1.02, lng: 1.0 },
      ],
    })
    .eq("id", zoneId);
  requireWrite(zoneShape.error, "zones.polygon");
  const babysittingZoneService = await ctx.admin
    .from("zone_services")
    .insert({ zone_id: zoneId, service_id: babysittingServiceId });
  requireWrite(babysittingZoneService.error, "zone_services.babysitting");
  ctx.registry.registerZoneService(zoneId, babysittingServiceId);
  const cleaningZoneService = await ctx.admin
    .from("zone_services")
    .insert({ zone_id: zoneId, service_id: cleaningServiceId });
  requireWrite(cleaningZoneService.error, "zone_services.cleaning");
  ctx.registry.registerZoneService(zoneId, cleaningServiceId);

  await completeAndApproveProvider(ctx, {
    stamp,
    providerUserId,
    providerId,
    providerClient,
    adminClient,
    serviceId: babysittingServiceId,
    zoneId,
    babysitting: true,
  });
  await completeAndApproveProvider(ctx, {
    stamp,
    providerUserId: cleaningUserId,
    providerId: cleaningProviderId,
    providerClient: cleaningClient,
    adminClient,
    serviceId: cleaningServiceId,
    zoneId,
    babysitting: false,
  });
  const { data: address, error: addressError } = await ctx.admin
    .from("addresses")
    .insert({
      user_id: customerId,
      label: "home",
      line1: "QA Babysit Home",
      area: "Isolated",
      city: "QA",
      lat: isolated.lat,
      lng: isolated.lng,
      is_default: true,
    })
    .select("id")
    .single();
  if (addressError) throw addressError;
  ctx.registry.registerAddress(address.id);

  return {
    stamp,
    providerUserId,
    adminUserId,
    customerId,
    otherUserId,
    providerAdminUserId,
    cleaningUserId,
    providerId,
    otherProviderId,
    providerAdminProviderId,
    cleaningProviderId,
    babysittingServiceId,
    cleaningServiceId,
    zoneId,
    addressId: address.id,
    providerClient,
    adminClient,
    customerClient,
    otherClient,
    providerAdminClient,
    cleaningClient,
    adminEmail,
  };
}

export async function insertOwnedChild(
  ctx: ProviderHarnessContext,
  customerId: string,
  dateOfBirth: string,
) {
  const { data, error } = await ctx.admin
    .from("family_members")
    .insert({
      customer_id: customerId,
      full_name: "QA Toddler",
      relationship: "daughter",
      date_of_birth: dateOfBirth,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}
