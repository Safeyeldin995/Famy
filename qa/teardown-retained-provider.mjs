/**
 * Operational disable for providers retained due to immutable booking FK history.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} providerId
 */
export async function disableRetainedProvider(admin, providerId) {
  const { error } = await admin.from("providers").update({
    is_active: false,
    vacation_mode: true,
  }).eq("id", providerId);
  if (error) {
    throw new Error(`[qa-retained-provider] disable failed for ${providerId}: ${error.message}`);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} providerId
 */
export async function verifyProviderMarketplaceIneligible(admin, providerId) {
  const { data: provider, error: providerError } = await admin
    .from("providers")
    .select("is_active,vacation_mode,onboarding_status,is_verified")
    .eq("id", providerId)
    .maybeSingle();
  if (providerError) throw providerError;
  if (!provider) {
    return { ineligible: true, reason: "missing-provider-row" };
  }
  if (provider.is_active) {
    return { ineligible: false, reason: "still-active" };
  }

  if (typeof admin.rpc === "function") {
    const { data, error } = await admin.rpc("provider_marketplace_eligibility", {
      p_provider_id: providerId,
    });
    if (!error && Array.isArray(data) && data.some((row) => row.is_eligible)) {
      return { ineligible: false, reason: "marketplace-still-eligible" };
    }
  }

  return { ineligible: true, reason: "inactive-or-vacation" };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string[]} providerIds
 */
export async function disableRetainedProviders(admin, providerIds) {
  /** @type {Array<{ providerId: string; ineligible: boolean; reason: string }>} */
  const results = [];
  for (const providerId of providerIds) {
    await disableRetainedProvider(admin, providerId);
    const check = await verifyProviderMarketplaceIneligible(admin, providerId);
    results.push({ providerId, ineligible: check.ineligible, reason: check.reason });
  }
  return results;
}
