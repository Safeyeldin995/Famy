import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/otp/__tests__/otpIntegration.harness";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("provider onboarding details/references RLS", () => {
  let providerUserId: string;
  let otherProviderUserId: string;
  let customerUserId: string;
  let adminUserId: string;
  let providerId: string;
  let otherProviderId: string;
  let providerClient: ReturnType<typeof createClient<Database>>;
  let otherProviderClient: ReturnType<typeof createClient<Database>>;
  let customerClient: ReturnType<typeof createClient<Database>>;
  let adminClient: ReturnType<typeof createClient<Database>>;
  let seededZoneId: string | undefined;
  let seededServiceId: string | undefined;

  async function createAuthedClient(email: string, password: string) {
    const anon = createClient<Database>(supabaseUrl!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    expect(signInErr).toBeNull();
    return createClient<Database>(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: `Bearer ${signIn!.session!.access_token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function assertOwnerCanSelect(
    client: ReturnType<typeof createClient<Database>>,
    targetProviderId: string,
  ) {
    const { data: details, error: detailsErr } = await client
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", targetProviderId)
      .single();
    expect(detailsErr).toBeNull();
    expect(details?.full_address).toBeTruthy();

    const { data: refs, error: refsErr } = await client
      .from("provider_references")
      .select("full_name")
      .eq("provider_id", targetProviderId);
    expect(refsErr).toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(2);
  }

  async function assertOwnerWriteBlocked(
    client: ReturnType<typeof createClient<Database>>,
    targetProviderId: string,
  ) {
    const { data: beforeDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", targetProviderId)
      .single();

    await client
      .from("provider_onboarding_details")
      .update({ full_address: "Blocked write attempt" })
      .eq("provider_id", targetProviderId);
    const { data: afterDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", targetProviderId)
      .single();
    expect(afterDetails?.full_address).toBe(beforeDetails?.full_address);

    const { count: beforeRefCount } = await admin!
      .from("provider_references")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", targetProviderId);
    await client.from("provider_references").insert({
      provider_id: targetProviderId,
      full_name: "Blocked Ref",
      relationship: "Friend",
      phone: "+201099988877",
      sort_order: 99,
    });
    const { count: afterRefCount } = await admin!
      .from("provider_references")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", targetProviderId);
    expect(afterRefCount).toBe(beforeRefCount);
  }

  async function seedEditableSectionsFor(
    client: ReturnType<typeof createClient<Database>>,
    address = "123 QA RLS Street",
  ) {
    await client.rpc("provider_save_onboarding_section", {
      p_section: "personal",
      p_payload: {
        legal_name: "QA RLS Provider",
        date_of_birth: "1990-01-01",
        gender: "female",
        governorate: "Cairo",
        area: "Maadi",
        full_address: address,
      },
    });
    await client.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "RLS Ref One", relationship: "Friend", phone: "+201011122233" },
          { full_name: "RLS Ref Two", relationship: "Neighbor", phone: "+201022233344" },
        ],
      },
    });
  }

  async function seedEditableSections() {
    await seedEditableSectionsFor(providerClient);
  }

  async function seedCompletionPrereqs() {
    await admin!.from("profiles").update({
      avatar_url: `https://cdn.example/qa-rls-avatar-${providerUserId}.jpg`,
    }).eq("id", providerUserId);

    const { data: category } = await admin!.from("categories").select("id").eq("slug", "home-cleaning").maybeSingle();
    let categoryId = category?.id;
    if (!categoryId) {
      const { data: createdCategory } = await admin!.from("categories").insert({
        slug: "home-cleaning",
        name_en: "Home Cleaning",
        name_ar: "Home Cleaning",
        is_active: true,
      }).select("id").single();
      categoryId = createdCategory!.id;
    } else {
      await admin!.from("categories").update({ is_active: true }).eq("id", categoryId);
    }
    const { data: service } = await admin!.from("services").insert({
      category_id: categoryId!,
      slug: `qa-rls-service-${Date.now()}`,
      name_en: "QA RLS Service",
      name_ar: "QA RLS Service",
      pricing_model: "hourly",
      base_price: 100,
      is_active: true,
    }).select("id").single();
    seededServiceId = service!.id;
    await admin!.from("provider_services").upsert({ provider_id: providerId, service_id: seededServiceId, status: "pending" });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "services",
      p_payload: { service_ids: [seededServiceId!] },
    });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "experience",
      p_payload: { years_experience: 3, bio_en: "QA RLS bio", bio_ar: "", languages: ["en"] },
    });
    const { data: zone } = await admin!.from("zones").insert({
      name_en: `QA RLS Zone ${Date.now()}`,
      name_ar: `QA RLS Zone ${Date.now()}`,
      boundary_type: "polygon",
      is_active: true,
      polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.01 }, { lat: 30.01, lng: 31 }],
    }).select("id").single();
    seededZoneId = zone!.id;
    await admin!.from("zone_providers").upsert({ zone_id: seededZoneId, provider_id: providerId });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "coverage",
      p_payload: { zone_ids: [seededZoneId!] },
    });
    for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
      await admin!.from("provider_documents").delete().eq("provider_id", providerId).eq("type", type);
      await admin!.from("provider_documents").insert({
        provider_id: providerId,
        type,
        storage_path: `${providerId}/${type}.pdf`,
        status: "pending",
      });
    }
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "review",
      p_payload: { confirmed: true },
    });

    const completion = await providerClient.rpc("provider_onboarding_completion", { p_provider_id: providerId });
    expect(completion.error).toBeNull();
    expect((completion.data as { complete?: boolean }).complete, JSON.stringify(completion.data)).toBe(true);
  }

  async function expectStatus(expected: string) {
    const { data, error } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", providerId)
      .single();
    expect(error).toBeNull();
    expect(data?.onboarding_status).toBe(expected);
  }

  async function approveRequiredDocuments() {
    const { data: docs } = await admin!.from("provider_documents")
      .select("id")
      .eq("provider_id", providerId)
      .in("type", ["id_card_front", "id_card_back", "profile_photo"]);
    for (const doc of docs ?? []) {
      const review = await adminClient.rpc("admin_review_provider_document", {
        p_document_id: doc.id,
        p_status: "approved",
      });
      expect(review.error).toBeNull();
    }
  }

  async function setNeedsChanges() {
    await seedCompletionPrereqs();
    const submit = await providerClient.rpc("provider_submit_onboarding");
    expect(submit.error).toBeNull();
    expect((submit.data as { ok?: boolean }).ok).toBe(true);
    const requestChanges = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "qa_rls",
      p_reason_public: "QA RLS reset",
    });
    expect(requestChanges.error).toBeNull();
    await expectStatus("NEEDS_CHANGES");
  }

  async function setSubmitted() {
    const { data: current } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", providerId)
      .single();
    if (!["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(current?.onboarding_status ?? "")) {
      await seedCompletionPrereqs();
      const submit = await providerClient.rpc("provider_submit_onboarding");
      expect(submit.error).toBeNull();
      expect((submit.data as { ok?: boolean }).ok).toBe(true);
      await expectStatus("SUBMITTED");
    }
  }

  async function setUnderReview() {
    await setSubmitted();
    const { data: current } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", providerId)
      .single();
    if (current?.onboarding_status === "SUBMITTED") {
      const review = await adminClient.rpc("admin_provider_onboarding_action", {
        p_provider_id: providerId,
        p_action: "start_review",
      });
      expect(review.error).toBeNull();
    }
    await expectStatus("UNDER_REVIEW");
  }

  async function setApproved() {
    const { data: current } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", providerId)
      .single();
    if (current?.onboarding_status === "APPROVED") {
      return;
    }
    await setUnderReview();
    await approveRequiredDocuments();
    const approve = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "approve",
    });
    expect(approve.error).toBeNull();
    await expectStatus("APPROVED");
  }

  async function setSuspended() {
    const { data: current } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", providerId)
      .single();
    if (current?.onboarding_status === "SUSPENDED") {
      return;
    }
    if (current?.onboarding_status !== "APPROVED") {
      await setApproved();
    }
    const suspend = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "suspend",
      p_reason_code: "qa_rls_suspend",
      p_reason_public: "QA RLS suspended",
    });
    expect(suspend.error).toBeNull();
    await expectStatus("SUSPENDED");
  }

  async function setRejectedForOtherProvider() {
    await seedEditableSectionsFor(otherProviderClient, "456 QA RLS Other Street");
    await admin!.from("profiles").update({
      avatar_url: `https://cdn.example/qa-rls-other-avatar-${otherProviderUserId}.jpg`,
    }).eq("id", otherProviderUserId);

    const { data: category } = await admin!.from("categories").select("id").eq("slug", "home-cleaning").maybeSingle();
    const categoryId = category!.id;
    const { data: service } = await admin!.from("services").insert({
      category_id: categoryId,
      slug: `qa-rls-other-service-${Date.now()}`,
      name_en: "QA RLS Other Service",
      name_ar: "QA RLS Other Service",
      pricing_model: "hourly",
      base_price: 100,
      is_active: true,
    }).select("id").single();
    await admin!.from("provider_services").upsert({
      provider_id: otherProviderId,
      service_id: service!.id,
      status: "pending",
    });
    await otherProviderClient.rpc("provider_save_onboarding_section", {
      p_section: "services",
      p_payload: { service_ids: [service!.id] },
    });
    await otherProviderClient.rpc("provider_save_onboarding_section", {
      p_section: "experience",
      p_payload: { years_experience: 2, bio_en: "QA RLS other bio", bio_ar: "", languages: ["en"] },
    });
    const { data: zone } = await admin!.from("zones").insert({
      name_en: `QA RLS Other Zone ${Date.now()}`,
      name_ar: `QA RLS Other Zone ${Date.now()}`,
      boundary_type: "polygon",
      is_active: true,
      polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.01 }, { lat: 30.01, lng: 31 }],
    }).select("id").single();
    await admin!.from("zone_providers").upsert({ zone_id: zone!.id, provider_id: otherProviderId });
    await otherProviderClient.rpc("provider_save_onboarding_section", {
      p_section: "coverage",
      p_payload: { zone_ids: [zone!.id] },
    });
    for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
      await admin!.from("provider_documents").delete().eq("provider_id", otherProviderId).eq("type", type);
      await admin!.from("provider_documents").insert({
        provider_id: otherProviderId,
        type,
        storage_path: `${otherProviderId}/${type}.pdf`,
        status: "pending",
      });
    }
    await otherProviderClient.rpc("provider_save_onboarding_section", {
      p_section: "review",
      p_payload: { confirmed: true },
    });
    const completion = await otherProviderClient.rpc("provider_onboarding_completion", {
      p_provider_id: otherProviderId,
    });
    expect(completion.error).toBeNull();
    const submit = await otherProviderClient.rpc("provider_submit_onboarding");
    expect(submit.error).toBeNull();
    const review = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: otherProviderId,
      p_action: "start_review",
    });
    expect(review.error).toBeNull();
    const reject = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: otherProviderId,
      p_action: "reject",
      p_reason_code: "qa_rls_reject",
      p_reason_public: "QA RLS rejected",
    });
    expect(reject.error).toBeNull();
    const { data: rejected } = await admin!.from("providers")
      .select("onboarding_status")
      .eq("id", otherProviderId)
      .single();
    expect(rejected?.onboarding_status).toBe("REJECTED");
  }

  beforeAll(async () => {
    const email = `qa-rls-${Date.now()}@famio.local`;
    const otherEmail = `qa-rls-other-${Date.now()}@famio.local`;
    const adminEmail = `qa-rls-admin-${Date.now()}@famio.local`;
    const customerEmail = `qa-rls-customer-${Date.now()}@famio.local`;

    const { data: created, error } = await admin!.auth.admin.createUser({
      email,
      password: "QaRls123!",
      email_confirm: true,
    });
    expect(error).toBeNull();
    providerUserId = created!.user!.id;
    await admin!.from("user_roles").delete().eq("user_id", providerUserId).eq("role", "customer");
    await admin!.from("user_roles").upsert({ user_id: providerUserId, role: "provider" });
    await admin!.from("profiles").upsert({
      id: providerUserId,
      full_name: "QA RLS Provider",
      phone: `+20100${Date.now().toString().slice(-7)}`,
    });

    const { data: otherCreated, error: otherErr } = await admin!.auth.admin.createUser({
      email: otherEmail,
      password: "QaRlsOther123!",
      email_confirm: true,
    });
    expect(otherErr).toBeNull();
    otherProviderUserId = otherCreated!.user!.id;
    await admin!.from("user_roles").delete().eq("user_id", otherProviderUserId).eq("role", "customer");
    await admin!.from("user_roles").upsert({ user_id: otherProviderUserId, role: "provider" });
    await admin!.from("profiles").upsert({
      id: otherProviderUserId,
      full_name: "QA RLS Other",
      phone: `+20101${Date.now().toString().slice(-7)}`,
    });

    const { data: adminCreated, error: adminCreateErr } = await admin!.auth.admin.createUser({
      email: adminEmail,
      password: "QaRlsAdmin123!",
      email_confirm: true,
    });
    expect(adminCreateErr).toBeNull();
    adminUserId = adminCreated!.user!.id;
    await admin!.from("user_roles").upsert({ user_id: adminUserId, role: "admin" });

    const { data: customerCreated, error: customerErr } = await admin!.auth.admin.createUser({
      email: customerEmail,
      password: "QaRlsCustomer123!",
      email_confirm: true,
    });
    expect(customerErr).toBeNull();
    customerUserId = customerCreated!.user!.id;
    await admin!.from("user_roles").upsert({ user_id: customerUserId, role: "customer" });
    await admin!.from("profiles").upsert({
      id: customerUserId,
      full_name: "QA RLS Customer",
      phone: `+20102${Date.now().toString().slice(-7)}`,
    });

    providerClient = await createAuthedClient(email, "QaRls123!");
    otherProviderClient = await createAuthedClient(otherEmail, "QaRlsOther123!");
    adminClient = await createAuthedClient(adminEmail, "QaRlsAdmin123!");
    customerClient = await createAuthedClient(customerEmail, "QaRlsCustomer123!");

    const { data: started, error: startErr } = await providerClient.rpc("provider_start_onboarding");
    expect(startErr).toBeNull();
    providerId = (started as { id: string }).id;
    const { data: otherStarted, error: otherStartErr } = await otherProviderClient.rpc("provider_start_onboarding");
    expect(otherStartErr).toBeNull();
    otherProviderId = (otherStarted as { id: string }).id;
    await seedEditableSections();
  });

  afterAll(async () => {
    if (!admin || !providerId) return;
    if (seededZoneId) await admin.from("zone_providers").delete().eq("zone_id", seededZoneId).eq("provider_id", providerId);
    if (seededZoneId) await admin.from("zones").delete().eq("id", seededZoneId);
    if (seededServiceId) await admin.from("provider_services").delete().eq("service_id", seededServiceId);
    if (seededServiceId) await admin.from("services").delete().eq("id", seededServiceId);
    await admin.from("provider_onboarding_events").delete().eq("provider_id", providerId);
    await admin.from("provider_references").delete().eq("provider_id", providerId);
    await admin.from("provider_onboarding_details").delete().eq("provider_id", providerId);
    if (otherProviderId) {
      await admin.from("provider_onboarding_events").delete().eq("provider_id", otherProviderId);
      await admin.from("provider_references").delete().eq("provider_id", otherProviderId);
      await admin.from("provider_onboarding_details").delete().eq("provider_id", otherProviderId);
    }
    await admin.from("providers").delete().eq("profile_id", providerUserId);
    await admin.from("providers").delete().eq("profile_id", otherProviderUserId);
    if (providerUserId) await admin.auth.admin.deleteUser(providerUserId);
    if (otherProviderUserId) await admin.auth.admin.deleteUser(otherProviderUserId);
    if (adminUserId) await admin.auth.admin.deleteUser(adminUserId);
    if (customerUserId) await admin.auth.admin.deleteUser(customerUserId);
  });

  it("allows DRAFT provider to read and edit own details/references", async () => {
    const { data: details, error: detailsErr } = await providerClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(detailsErr).toBeNull();
    expect(details?.full_address).toBe("123 QA RLS Street");

    const { data: refs, error: refsErr } = await providerClient
      .from("provider_references")
      .select("full_name")
      .eq("provider_id", providerId);
    expect(refsErr).toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(2);

    const { error: updateErr } = await providerClient
      .from("provider_onboarding_details")
      .update({ area: "Zamalek" })
      .eq("provider_id", providerId);
    expect(updateErr).toBeNull();

    const { error: insertErr } = await providerClient.from("provider_references").insert({
      provider_id: providerId,
      full_name: "Draft Ref",
      relationship: "Colleague",
      phone: "+201033344455",
      sort_order: 99,
    });
    expect(insertErr).toBeNull();
    await providerClient.from("provider_references").delete().eq("provider_id", providerId).eq("full_name", "Draft Ref");
    await providerClient.from("provider_onboarding_details").update({ area: "Maadi" }).eq("provider_id", providerId);
  });

  it("allows NEEDS_CHANGES provider to read and edit own details/references", async () => {
    await setNeedsChanges();
    const { data: details, error: detailsErr } = await providerClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(detailsErr).toBeNull();
    expect(details?.full_address).toBeTruthy();

    const { error: updateErr } = await providerClient
      .from("provider_onboarding_details")
      .update({ area: "Heliopolis" })
      .eq("provider_id", providerId);
    expect(updateErr).toBeNull();
    await providerClient.from("provider_onboarding_details").update({ area: "Maadi" }).eq("provider_id", providerId);
  });

  it("allows SUBMITTED provider to read but not edit details/references", async () => {
    await setSubmitted();
    const { data: beforeDetails, error: detailsErr } = await providerClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(detailsErr).toBeNull();
    expect(beforeDetails?.full_address).toBeTruthy();

    const { data: refs, error: refsErr } = await providerClient
      .from("provider_references")
      .select("full_name")
      .eq("provider_id", providerId);
    expect(refsErr).toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(2);

    await providerClient
      .from("provider_onboarding_details")
      .update({ full_address: "Blocked while submitted" })
      .eq("provider_id", providerId);
    const { data: afterDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(afterDetails?.full_address).toBe(beforeDetails?.full_address);

    const { count: beforeRefCount } = await admin!
      .from("provider_references")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId);
    await providerClient.from("provider_references").insert({
      provider_id: providerId,
      full_name: "Blocked Ref",
      relationship: "Friend",
      phone: "+201099988877",
      sort_order: 99,
    });
    const { count: afterRefCount } = await admin!
      .from("provider_references")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId);
    expect(afterRefCount).toBe(beforeRefCount);
  });

  it("allows UNDER_REVIEW provider to read but not edit details/references", async () => {
    await setUnderReview();
    const { data: beforeDetails, error: detailsErr } = await providerClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(detailsErr).toBeNull();

    await providerClient
      .from("provider_onboarding_details")
      .update({ full_address: "Blocked while under review" })
      .eq("provider_id", providerId);
    const { data: afterDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(afterDetails?.full_address).toBe(beforeDetails?.full_address);
  });

  it("allows APPROVED provider to read but not edit details/references", async () => {
    await setApproved();
    await assertOwnerCanSelect(providerClient, providerId);
    await assertOwnerWriteBlocked(providerClient, providerId);
  });

  it("allows SUSPENDED provider to read but not edit details/references", async () => {
    await setSuspended();
    await assertOwnerCanSelect(providerClient, providerId);
    await assertOwnerWriteBlocked(providerClient, providerId);
  });

  it("allows REJECTED provider to read but not edit details/references", async () => {
    await setRejectedForOtherProvider();
    await assertOwnerCanSelect(otherProviderClient, otherProviderId);
    await assertOwnerWriteBlocked(otherProviderClient, otherProviderId);
  });

  it("denies unrelated provider from reading or editing another provider rows", async () => {
    const { data: details, error: detailsErr } = await otherProviderClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId);
    expect(detailsErr).toBeNull();
    expect(details ?? []).toHaveLength(0);

    const { data: refs, error: refsErr } = await otherProviderClient
      .from("provider_references")
      .select("full_name")
      .eq("provider_id", providerId);
    expect(refsErr).toBeNull();
    expect(refs ?? []).toHaveLength(0);

    const { data: beforeDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    await otherProviderClient
      .from("provider_onboarding_details")
      .update({ full_address: "Cross-account write" })
      .eq("provider_id", providerId);
    const { data: afterDetails } = await admin!
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(afterDetails?.full_address).toBe(beforeDetails?.full_address);
  });

  it("denies unrelated customer from reading another provider rows", async () => {
    const { data: details, error: detailsErr } = await customerClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId);
    expect(detailsErr).toBeNull();
    expect(details ?? []).toHaveLength(0);

    const { data: refs, error: refsErr } = await customerClient
      .from("provider_references")
      .select("full_name")
      .eq("provider_id", providerId);
    expect(refsErr).toBeNull();
    expect(refs ?? []).toHaveLength(0);
  });

  it("allows admin review reads for details and references", async () => {
    const { data: details, error: detailsErr } = await adminClient
      .from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(detailsErr).toBeNull();
    expect(details?.full_address).toBeTruthy();

    const { data: refs, error: refsErr } = await adminClient
      .from("provider_references")
      .select("full_name, phone")
      .eq("provider_id", providerId);
    expect(refsErr).toBeNull();
    expect(refs?.length).toBeGreaterThanOrEqual(2);
  });
});
