import { supabaseAdmin } from "../admin-client.mjs";
import { readRegistry } from "../registry.mjs";

const REGISTRY_PROVIDER_NAME = "QA_provider_e2e";

/** Resets the registry provider to a clean DRAFT baseline (QA-only RPC when history blocks delete). */
export async function resetRegistryProviderToDraft(providerUserId = registryProviderUserId()) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", providerUserId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.id) {
    throw new Error(`Registry provider profile missing for ${providerUserId}. Re-run Playwright global setup.`);
  }

  const { data: created, error: resetError } = await supabaseAdmin.rpc("qa_reset_registry_provider_to_draft", {
    p_profile_id: providerUserId,
  });
  if (resetError) throw resetError;

  const { error: profileUpdateError } = await supabaseAdmin
    .from("profiles")
    .update({
      full_name: REGISTRY_PROVIDER_NAME,
      avatar_url: null,
    })
    .eq("id", providerUserId);
  if (profileUpdateError) throw profileUpdateError;

  return created;
}

export function registryProviderUserId() {
  const providerUser = readRegistry().users.find((user) => user.key === "provider");
  if (!providerUser?.userId) throw new Error("Registry provider user missing. Run Playwright global setup first.");
  return providerUser.userId;
}

export async function captureRegistryProviderSnapshot(providerUserId = registryProviderUserId()) {
  const { data: provider } = await supabaseAdmin.from("providers")
    .select("id, is_verified, is_active, onboarding_status, vacation_mode, bio_en, bio_ar, years_experience, city")
    .eq("profile_id", providerUserId)
    .single();
  const { data: profile } = await supabaseAdmin.from("profiles")
    .select("full_name, avatar_url")
    .eq("id", providerUserId)
    .single();
  return { provider, profile, providerUserId };
}

export async function restoreRegistryProviderSnapshot(snapshot) {
  await resetRegistryProviderToDraft(snapshot.providerUserId);
}

/** Uploads a tiny avatar object so signed-URL tests have a real storage object. */
export async function ensureRegistryProviderAvatar(providerUserId = registryProviderUserId()) {
  const storagePath = `${providerUserId}/qa-avatar.jpg`;
  const payload = new TextEncoder().encode("QA avatar placeholder");
  const { error: uploadError } = await supabaseAdmin.storage.from("avatars").upload(storagePath, payload, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (uploadError) throw uploadError;
  const { error: profileError } = await supabaseAdmin.from("profiles").update({ avatar_url: storagePath }).eq("id", providerUserId);
  if (profileError) throw profileError;
  return storagePath;
}
