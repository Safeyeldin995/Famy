import { supabaseAdmin } from "../admin-client.mjs";
import { authenticatedClient } from "../authenticated-client.mjs";
import { loadEnv } from "../env.mjs";
import { ensureRegistryProviderAvatar, resetRegistryProviderToDraft } from "./registry-fixtures.mjs";

loadEnv();

const REGISTRY_PROVIDER_NAME = "QA_provider_e2e";

async function ensurePhase1Service() {
  let { data: category } = await supabaseAdmin.from("categories").select("id, is_active").eq("slug", "home-cleaning").maybeSingle();
  if (!category?.id || !category.is_active) {
    if (category?.id) {
      await supabaseAdmin.from("categories").update({ is_active: true }).eq("id", category.id);
    } else {
      const { data: createdCategory, error: categoryError } = await supabaseAdmin.from("categories").insert({
        slug: "home-cleaning", name_en: "Home Cleaning", name_ar: "Home Cleaning", is_active: true,
      }).select("id").single();
      if (categoryError && !`${categoryError.message}`.includes("duplicate")) throw categoryError;
      category = createdCategory ?? (await supabaseAdmin.from("categories").select("id, is_active").eq("slug", "home-cleaning").single()).data;
      if (category?.id && !category.is_active) {
        await supabaseAdmin.from("categories").update({ is_active: true }).eq("id", category.id);
      }
    }
  }

  const { data: service, error: serviceError } = await supabaseAdmin.from("services").insert({
    category_id: category.id,
    slug: `qa-onboard-service-${Date.now()}`,
    name_en: "QA Onboard Service",
    name_ar: "QA Onboard Service",
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

async function ensureActiveZone() {
  const { data: zone } = await supabaseAdmin.from("zones").insert({
    name_en: `QA Onboard Zone ${Date.now()}`,
    name_ar: `QA Onboard Zone ${Date.now()}`,
    boundary_type: "polygon",
    is_active: true,
    polygon: [{ lat: 30, lng: 31 }, { lat: 30, lng: 31.01 }, { lat: 30.01, lng: 31 }],
  }).select("id").single();
  return zone.id;
}

async function saveOnboardingSection(providerClient, section, payload) {
  const { data, error } = await providerClient.rpc("provider_save_onboarding_section", {
    p_section: section,
    p_payload: payload,
  });
  if (error) throw error;
  return data;
}

/** Completes onboarding data and submits without admin approval. */
export async function submitProviderOnboarding(providerUserId, opts = {}) {
  if (opts.reset !== false) {
    await resetRegistryProviderToDraft(providerUserId);
  }

  const { data: providerRow, error: providerError } = await supabaseAdmin
    .from("providers")
    .select("id, profile_id, onboarding_status")
    .eq("profile_id", providerUserId)
    .single();
  if (providerError) throw providerError;

  const providerId = providerRow.id;
  const serviceId = opts.serviceId ?? await ensurePhase1Service();
  const zoneId = opts.zoneId ?? await ensureActiveZone();
  const providerClient = authenticatedClient("provider");
  const { data: authUser, error: authError } = await providerClient.auth.getUser();
  if (authError) throw authError;
  if (authUser.user?.id !== providerUserId) {
    throw new Error(`Provider auth session mismatch: expected ${providerUserId}, got ${authUser.user?.id ?? "none"}`);
  }

  await ensureRegistryProviderAvatar(providerUserId);
  await supabaseAdmin.from("profiles").update({
    full_name: opts.fullName ?? REGISTRY_PROVIDER_NAME,
  }).eq("id", providerUserId);

  await saveOnboardingSection(providerClient, "personal", {
    legal_name: opts.fullName ?? REGISTRY_PROVIDER_NAME,
    date_of_birth: "1990-01-01",
    gender: "female",
    governorate: "Cairo",
    area: "Maadi",
    full_address: "123 QA Street",
  });
  await saveOnboardingSection(providerClient, "services", { service_ids: [serviceId] });
  await saveOnboardingSection(providerClient, "experience", {
    years_experience: 5,
    bio_en: "QA submit onboarding bio",
    bio_ar: "",
    languages: ["en"],
  });
  await saveOnboardingSection(providerClient, "coverage", { zone_ids: [zoneId] });
  await saveOnboardingSection(providerClient, "references", {
    references: [
      { full_name: "Ref One", relationship: "Friend", phone: "+201011111111" },
      { full_name: "Ref Two", relationship: "Neighbor", phone: "+201022222222" },
    ],
  });
  await saveOnboardingSection(providerClient, "review", { confirmed: true });

  for (const type of ["id_card_front", "id_card_back", "profile_photo"]) {
    await supabaseAdmin.from("provider_documents").delete().eq("provider_id", providerId).eq("type", type);
    const { error: docError } = await supabaseAdmin.from("provider_documents").insert({
      provider_id: providerId,
      type,
      storage_path: `${providerId}/${type}.pdf`,
      status: "pending",
    });
    if (docError) throw docError;
  }

  const completion = await providerClient.rpc("provider_onboarding_completion", { p_provider_id: providerId });
  if (completion.error) throw completion.error;
  if (!completion.data?.complete) {
    throw new Error(`Onboarding fixture incomplete before submit: ${JSON.stringify(completion.data)}`);
  }

  const submit = await providerClient.rpc("provider_submit_onboarding");
  if (submit.error) throw submit.error;
  if (!submit.data?.ok) {
    throw new Error(`provider_submit_onboarding returned incomplete payload: ${JSON.stringify(submit.data)}`);
  }

  const { data: submittedRow, error: submittedLookupError } = await supabaseAdmin.from("providers")
    .select("onboarding_status")
    .eq("id", providerId)
    .single();
  if (submittedLookupError) throw submittedLookupError;
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(submittedRow.onboarding_status)) {
    throw new Error(`provider_submit_onboarding did not submit: ${JSON.stringify(submittedRow)}`);
  }

  return { providerId, zoneId, serviceId, providerUserId };
}

/** Completes provider onboarding through canonical RPCs only (no legacy force-approve). */
export async function completeProviderOnboarding(providerUserId, opts = {}) {
  const submitted = await submitProviderOnboarding(providerUserId, opts);
  const adminClient = authenticatedClient("admin");
  const providerId = submitted.providerId;

  const startReview = await adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: providerId,
    p_action: "start_review",
  });
  if (startReview.error) throw startReview.error;

  const { data: docs } = await supabaseAdmin.from("provider_documents")
    .select("id, type")
    .eq("provider_id", providerId)
    .in("type", ["id_card_front", "id_card_back"]);
  for (const doc of docs ?? []) {
    const review = await adminClient.rpc("admin_review_provider_document", {
      p_document_id: doc.id,
      p_status: "approved",
    });
    if (review.error) throw review.error;
  }

  const approve = await adminClient.rpc("admin_provider_onboarding_action", {
    p_provider_id: providerId,
    p_action: "approve",
  });
  if (approve.error) throw approve.error;

  const { data: approved } = await supabaseAdmin.from("providers")
    .select("onboarding_status, is_verified, is_active")
    .eq("id", providerId)
    .single();
  if (approved.onboarding_status !== "APPROVED" || !approved.is_verified) {
    throw new Error(`Onboarding fixture approval failed: ${JSON.stringify(approved)}`);
  }

  return submitted;
}
