import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  createOtpIntegrationClient,
  supabaseUrl,
} from "@/lib/otp/__tests__/otpIntegration.harness";
import { IntegrationFixtureRegistry } from "@/lib/qa/integrationFixtureRegistry";
import {
  cleanupProviderHarness,
  createAuthedClient,
  createRegisteredAuthUser,
  registerQaService,
  registerQaZone,
  startRegisteredProvider,
  withRegisteredEphemeralUser,
  type ProviderHarnessContext,
} from "./providerOnboarding.harness";

const admin = createOtpIntegrationClient();
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const describeIf = admin && supabaseUrl && anonKey ? describe : describe.skip;

describeIf("provider onboarding RPC", () => {
  const registry = new IntegrationFixtureRegistry({ suite: "providerOnboarding.integration" });
  const ctx: ProviderHarnessContext = { registry, admin: admin!, anonKey: anonKey! };
  let providerUserId: string;
  let providerId: string;
  let adminUserId: string;
  let providerClient: SupabaseClient<Database>;
  let adminClient: SupabaseClient<Database>;

  beforeAll(async () => {
    const stamp = Date.now();
    const email = `qa-onboard-${stamp}@famio.local`;
    const adminEmail = `qa-onboard-admin-${stamp}@famio.local`;
    providerUserId = await createRegisteredAuthUser(ctx, {
      email,
      password: "QaOnboard123!",
      role: "provider",
      fullName: "QA Onboard",
      phone: `+20100${stamp.toString().slice(-7)}`,
    });
    adminUserId = await createRegisteredAuthUser(ctx, {
      email: adminEmail,
      password: "QaAdminOnboard123!",
      role: "admin",
      fullName: adminEmail,
      phone: `+20101${stamp.toString().slice(-7)}`,
      admin: true,
    });

    providerClient = await createAuthedClient(email, "QaOnboard123!", anonKey!);
    adminClient = await createAuthedClient(adminEmail, "QaAdminOnboard123!", anonKey!);
    providerId = await startRegisteredProvider(ctx, providerClient);
  });

  afterAll(async () => {
    if (!admin) return;
    await cleanupProviderHarness(ctx);
  });

  it("reports incomplete completion for fresh draft provider", async () => {
    const { data, error } = await providerClient.rpc("provider_onboarding_completion", { p_provider_id: providerId });
    expect(error).toBeNull();
    expect((data as { complete: boolean }).complete).toBe(false);
    expect(Object.keys((data as { errors: Record<string, string> }).errors ?? {}).length).toBeGreaterThan(0);
  });

  it("blocks submission when mandatory sections are missing", async () => {
    const { data, error } = await providerClient.rpc("provider_submit_onboarding");
    expect(error).toBeNull();
    expect((data as { ok: boolean }).ok).toBe(false);
    expect((data as { errors: unknown }).errors).toBeTruthy();
  });

  it("normalizes reference phone numbers server-side", async () => {
    const { error } = await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "01001112233" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "01002223344" },
        ],
      },
    });
    expect(error).toBeNull();
    const { data: refs } = await admin!.from("provider_references").select("phone").eq("provider_id", providerId);
    expect(refs?.[0]?.phone).toMatch(/^\+20/);
  });

  it("prevents provider self-approval via admin RPC", async () => {
    const { error } = await providerClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "approve",
    });
    expect(error).not.toBeNull();
  });

  it("does not expose internal notes in provider snapshot", async () => {
    const { data, error } = await providerClient.rpc("provider_onboarding_snapshot");
    expect(error).toBeNull();
    expect(JSON.stringify(data)).not.toContain("review_notes_internal");
  });

  it("returns idempotent result on duplicate submission while already submitted", async () => {
    const { error: profileUpdateError } = await admin!.from("profiles").update({
      avatar_url: "https://cdn.example/qa-onboard-avatar.jpg",
      full_name: "QA Onboard",
    }).eq("id", providerUserId);
    expect(profileUpdateError).toBeNull();
    await admin!.from("provider_onboarding_details").upsert({
      provider_id: providerId,
      date_of_birth: "1990-01-01",
      governorate: "Cairo",
      area: "Maadi",
      full_address: "123 QA Street",
      accuracy_confirmed_at: new Date().toISOString(),
    });
    await admin!.from("providers").update({ bio_en: "QA onboarding bio", years_experience: 3 }).eq("id", providerId);
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "+201001112233" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "+201002223344" },
        ],
      },
    });

    const serviceId = await registerQaService(ctx, {
      slug: `qa-onboard-service-${Date.now()}`,
      name: "QA Onboard Service",
    });
    await admin!.from("provider_services").upsert({ provider_id: providerId, service_id: serviceId, status: "pending" });
    ctx.registry.registerProviderService(providerId, serviceId);

    const zoneId = await registerQaZone(ctx, {
      name: `QA Onboard Zone ${Date.now()}`,
      providerId,
    });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "services",
      p_payload: { service_ids: [serviceId] },
    });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "coverage",
      p_payload: { zone_ids: [zoneId] },
    });

    for (const type of ["id_card_front", "id_card_back", "profile_photo"] as const) {
      await admin!.from("provider_documents").delete().eq("provider_id", providerId).eq("type", type);
      const { error: docError } = await admin!.from("provider_documents").insert({
        provider_id: providerId,
        type,
        storage_path: `${providerId}/${type}.pdf`,
        status: "pending",
      });
      expect(docError).toBeNull();
    }

    const { data: completion, error: completionError } = await providerClient.rpc("provider_onboarding_completion", {
      p_provider_id: providerId,
    });
    expect(completionError).toBeNull();
    expect(completion, JSON.stringify(completion)).toMatchObject({ complete: true });

    const first = await providerClient.rpc("provider_submit_onboarding");
    const second = await providerClient.rpc("provider_submit_onboarding");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((first.data as { ok?: boolean }).ok).toBe(true);
    const payload = second.data as { ok?: boolean; already_submitted?: boolean; status?: string } | null;
    expect(payload?.already_submitted === true || payload?.status === "SUBMITTED").toBe(true);

    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "qa_reset",
      p_reason_public: "QA reset after duplicate submission test",
    });
  });

  it("records audit events for legitimate onboarding transitions", async () => {
    const submit = await providerClient.rpc("provider_submit_onboarding");
    expect(submit.error).toBeNull();
    const review = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "start_review",
    });
    expect(review.error).toBeNull();

    const { data: events, error: eventsErr } = await admin!.from("provider_onboarding_events")
      .select("action, new_status")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false })
      .limit(10);
    expect(eventsErr).toBeNull();
    expect(events?.some((event) => event.new_status === "UNDER_REVIEW")).toBe(true);
    expect(events?.some((event) => event.new_status === "SUBMITTED")).toBe(true);

    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "qa_reset",
      p_reason_public: "QA reset after audit event test",
    });
  });

  it("rejects duplicate reference phone numbers", async () => {
    const { error } = await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "01011112233" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "01011112233" },
        ],
      },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/distinct|duplicate/i);
  });

  it("blocks admin approval when application is incomplete", async () => {
    const { error } = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "approve",
    });
    expect(error).not.toBeNull();
    expect(error?.message).not.toBe("Admin authorization required.");
  });

  it("requires rejection reason for document review", async () => {
    const { data: doc } = await admin!.from("provider_documents").insert({
      provider_id: providerId, type: "id_card_front", storage_path: `${providerId}/test-front.pdf`, status: "pending",
    }).select().single();
    const { error } = await adminClient.rpc("admin_review_provider_document", {
      p_document_id: doc!.id, p_status: "rejected",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("reason");
    await admin!.from("provider_documents").delete().eq("id", doc!.id);
  });

  it("excludes suspended providers from marketplace eligibility", async () => {
    await admin!.from("profiles").update({
      avatar_url: "https://cdn.example/qa-suspend-avatar.jpg",
      full_name: "QA Suspend Provider",
    }).eq("id", providerUserId);
    await admin!.from("provider_onboarding_details").upsert({
      provider_id: providerId,
      date_of_birth: "1990-01-01",
      governorate: "Cairo",
      area: "Maadi",
      full_address: "123 QA Street",
      accuracy_confirmed_at: new Date().toISOString(),
    });
    await admin!.from("providers").update({ bio_en: "QA bio", years_experience: 3 }).eq("id", providerId);
    const { data: serviceIdRow } = await admin!.from("services").select("id").eq("is_active", true).limit(1).single();
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "services",
      p_payload: { service_ids: [serviceIdRow!.id] },
    });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "references",
      p_payload: {
        references: [
          { full_name: "Ref One", relationship: "Friend", phone: "+201011111111" },
          { full_name: "Ref Two", relationship: "Neighbor", phone: "+201022222222" },
        ],
      },
    });
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "experience",
      p_payload: { years_experience: 3, bio_en: "QA bio", bio_ar: "", languages: ["en"] },
    });
    const { data: zoneRow } = await admin!.from("zones").select("id").eq("is_active", true).limit(1).maybeSingle();
    if (zoneRow?.id) {
      await providerClient.rpc("provider_save_onboarding_section", {
        p_section: "coverage",
        p_payload: { zone_ids: [zoneRow.id] },
      });
    }
    await providerClient.rpc("provider_save_onboarding_section", {
      p_section: "review",
      p_payload: { confirmed: true },
    });
    for (const type of ["id_card_front", "id_card_back"] as const) {
      await admin!.from("provider_documents").insert({
        provider_id: providerId, type, storage_path: `${providerId}/${type}-suspend.pdf`, status: "pending",
      });
    }
    await providerClient.rpc("provider_submit_onboarding");
    await adminClient.rpc("admin_provider_onboarding_action", { p_provider_id: providerId, p_action: "start_review" });
    const { data: docs } = await admin!.from("provider_documents").select("id").eq("provider_id", providerId).in("type", ["id_card_front", "id_card_back"]);
    for (const doc of docs ?? []) {
      await adminClient.rpc("admin_review_provider_document", { p_document_id: doc.id, p_status: "approved" });
    }
    await adminClient.rpc("admin_provider_onboarding_action", { p_provider_id: providerId, p_action: "approve" });

    const { error: suspendError } = await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "suspend",
      p_reason_code: "qa_suspend",
      p_reason_public: "QA suspension test",
    });
    expect(suspendError).toBeNull();
    const { data } = await admin!.rpc("provider_marketplace_eligibility", { p_provider_id: providerId });
    expect((data ?? []).every((row: { is_eligible: boolean }) => !row.is_eligible)).toBe(true);
    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "unsuspend",
    });
  });

  it("rejects legacy force-approve on draft provider", async () => {
    await withRegisteredEphemeralUser(ctx, {
      email: `qa-draft-force-${Date.now()}@famio.local`,
      password: "QaDraftForce123!",
      role: "provider",
      fullName: "QA Draft Force",
      phone: `+20100${Date.now().toString().slice(-7)}`,
    }, async ({ client: draftClient, ephemeral }) => {
      const { data: started, error: startErr } = await draftClient.rpc("provider_start_onboarding");
      expect(startErr).toBeNull();
      const draftId = (started as { id: string }).id;
      ephemeral.registerProvider(draftId);
      const { error } = await adminClient.rpc("admin_set_provider_verification", {
        p_provider_id: draftId,
        p_verified: true,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/submitted or in-review|cannot be approved/i);
    });
  });

  it("denies cross-account completion queries", async () => {
    await withRegisteredEphemeralUser(ctx, {
      email: `qa-other-${Date.now()}@famio.local`,
      password: "QaOther123!",
      role: "customer",
      fullName: "QA Other Customer",
      phone: `+20102${Date.now().toString().slice(-7)}`,
    }, async ({ client: otherClient }) => {
      const { error } = await otherClient.rpc("provider_onboarding_completion", { p_provider_id: providerId });
      expect(error).not.toBeNull();
    });
  });

  it("denies provider self-approval of own documents", async () => {
    const { data: doc } = await admin!.from("provider_documents").insert({
      provider_id: providerId, type: "id_card_front", storage_path: `${providerId}/self-review.pdf`, status: "pending",
    }).select().single();
    const { error } = await providerClient.from("provider_documents").update({ status: "approved" as never }).eq("id", doc!.id);
    const { data: unchanged } = await admin!.from("provider_documents").select("status").eq("id", doc!.id).single();
    expect(unchanged?.status).toBe("pending");
    if (error) expect(error.message).toMatch(/policy|permission|review|42501/i);
    await admin!.from("provider_documents").delete().eq("id", doc!.id);
  });

  it("does not expose review_notes_internal via provider select", async () => {
    await (admin as any).from("provider_admin_internal_notes").upsert({
      provider_id: providerId,
      review_notes_internal: "SECRET_QA_NOTE",
    });
    const { data: safe, error: safeErr } = await providerClient.from("providers")
      .select("id, onboarding_status, review_reason_public")
      .eq("id", providerId)
      .maybeSingle();
    expect(safeErr).toBeNull();
    expect(safe).toBeTruthy();
    expect(JSON.stringify(safe)).not.toContain("SECRET_QA_NOTE");

    const { data: internalRow, error: internalErr } = await (providerClient as any)
      .from("provider_admin_internal_notes")
      .select("review_notes_internal")
      .eq("provider_id", providerId)
      .maybeSingle();
    expect(internalRow ?? null).toBeNull();
    if (internalErr) expect(internalErr.message).toMatch(/policy|permission|42501/i);

    await (admin as any).from("provider_admin_internal_notes").delete().eq("provider_id", providerId);
  });

  it("allows admin provider reads using select=* after internal notes separation", async () => {
    const { data, error } = await adminClient.from("providers").select("*, profile:profiles(full_name)").eq("id", providerId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(providerId);
    expect((data as { profile?: { full_name?: string } })?.profile?.full_name).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain("SECRET_ADMIN_READ");
  });

  it("denies customer direct providers table reads", async () => {
    await withRegisteredEphemeralUser(ctx, {
      email: `qa-customer-read-${Date.now()}@famio.local`,
      password: "QaCustomerRead123!",
      role: "customer",
      fullName: "QA Customer Read",
      phone: `+20103${Date.now().toString().slice(-7)}`,
    }, async ({ client: customerClient }) => {
      const { data, error } = await customerClient.from("providers").select("id, onboarding_status").eq("id", providerId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  });

  it("denies direct apply_provider_onboarding_status from authenticated clients", async () => {
    const { error: adminErr } = await (adminClient as any).rpc("apply_provider_onboarding_status", {
      p_provider_id: providerId,
      p_new_status: "APPROVED",
      p_actor_id: adminUserId,
      p_actor_role: "admin",
      p_action: "approve",
    });
    expect(adminErr).not.toBeNull();
    expect(adminErr?.message).toMatch(/not permitted|permission denied|42501|Could not find/i);

    const { error: providerErr } = await (providerClient as any).rpc("apply_provider_onboarding_status", {
      p_provider_id: providerId,
      p_new_status: "APPROVED",
      p_actor_id: providerUserId,
      p_actor_role: "admin",
      p_action: "approve",
    });
    expect(providerErr).not.toBeNull();
  });

  it("denies direct log_provider_onboarding_event from authenticated clients", async () => {
    const { error } = await (providerClient as any).rpc("log_provider_onboarding_event", {
      p_provider_id: providerId,
      p_actor_id: providerUserId,
      p_actor_role: "admin",
      p_action: "forged_event",
      p_previous_status: "DRAFT",
      p_new_status: "APPROVED",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not permitted|permission denied|42501|Could not find/i);
  });

  it("denies anonymous access to internal onboarding functions", async () => {
    const anon = createClient<Database>(supabaseUrl!, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: statusErr } = await (anon as any).rpc("apply_provider_onboarding_status", {
      p_provider_id: providerId,
      p_new_status: "APPROVED",
      p_actor_id: providerUserId,
      p_actor_role: "admin",
      p_action: "approve",
    });
    expect(statusErr).not.toBeNull();
    const { error: logErr } = await (anon as any).rpc("log_provider_onboarding_event", {
      p_provider_id: providerId,
      p_actor_id: providerUserId,
      p_actor_role: "admin",
      p_action: "forged_event",
      p_previous_status: "DRAFT",
      p_new_status: "APPROVED",
    });
    expect(logErr).not.toBeNull();
  });

  it("blocks direct reference writes when onboarding is not editable", async () => {
    await providerClient.rpc("provider_submit_onboarding");
    const { data: statusRow } = await admin!.from("providers").select("onboarding_status").eq("id", providerId).single();
    if (statusRow?.onboarding_status === "SUBMITTED") {
      await adminClient.rpc("admin_provider_onboarding_action", {
        p_provider_id: providerId,
        p_action: "start_review",
      });
    }
    const { error } = await providerClient.from("provider_references").insert({
      provider_id: providerId,
      full_name: "Blocked Ref",
      relationship: "Friend",
      phone: "+201099988877",
      sort_order: 99,
    });
    expect(error).not.toBeNull();
    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "qa_reset",
      p_reason_public: "QA reset after reference write test",
    });
  });

  it("blocks direct onboarding detail writes when onboarding is not editable", async () => {
    await providerClient.rpc("provider_submit_onboarding");
    const { data: beforeRow } = await admin!.from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    const { error } = await (providerClient as any).from("provider_onboarding_details").update({
      full_address: "Should not update while submitted",
    }).eq("provider_id", providerId);
    const { data: afterRow } = await admin!.from("provider_onboarding_details")
      .select("full_address")
      .eq("provider_id", providerId)
      .single();
    expect(afterRow?.full_address).toBe(beforeRow?.full_address);
    if (error) expect(error.message).toMatch(/policy|permission|42501/i);
    await adminClient.rpc("admin_provider_onboarding_action", {
      p_provider_id: providerId,
      p_action: "request_changes",
      p_reason_code: "qa_reset",
      p_reason_public: "QA reset after details write test",
    });
  });
});
