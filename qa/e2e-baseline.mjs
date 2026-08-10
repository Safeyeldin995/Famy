/**
 * Read-only QA E2E baseline preconditions — no writes, no repair.
 */
export const REQUIRED_SETTINGS_KEYS = ["billing", "service_areas"];

/** Protected catalog counts verified against QA migrations/seeds. */
export const EXPECTED_ACTIVE_CATEGORY_COUNT = 6;
export const EXPECTED_SEEDED_NON_QA_SERVICE_COUNT = 18;
export const EXPECTED_STORAGE_BUCKET_COUNT = 4;

const REQUIRED_STORAGE_BUCKETS = [
  "avatars",
  "provider-documents",
  "payment-proofs",
  "case-evidence",
];

/**
 * Fail fast when required protected QA baseline rows are missing.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 */
export async function assertQaE2eBaselineReadOnly(admin) {
  const missingSettings = [];
  for (const key of REQUIRED_SETTINGS_KEYS) {
    const { data, error } = await admin.from("settings").select("key").eq("key", key).maybeSingle();
    if (error) {
      throw new Error(`[qa-e2e-baseline] failed to read settings key ${key}: ${error.message}`);
    }
    if (!data) missingSettings.push(key);
  }
  if (missingSettings.length) {
    throw new Error(
      `[qa-e2e-baseline] missing required settings rows: ${missingSettings.join(", ")}. `
      + "Restore QA baseline data through an approved repair before running E2E.",
    );
  }

  for (const key of REQUIRED_SETTINGS_KEYS) {
    const { count, error } = await admin.from("settings").select("key", { count: "exact", head: true }).eq("key", key);
    if (error) throw new Error(`[qa-e2e-baseline] failed to count settings key ${key}: ${error.message}`);
    if ((count ?? 0) !== 1) {
      throw new Error(`[qa-e2e-baseline] settings key ${key} must exist exactly once; found ${count ?? 0}`);
    }
  }

  const { count: categoryCount, error: categoryError } = await admin
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (categoryError) throw new Error(`[qa-e2e-baseline] failed to count categories: ${categoryError.message}`);
  if (categoryCount !== EXPECTED_ACTIVE_CATEGORY_COUNT) {
    throw new Error(
      `[qa-e2e-baseline] expected ${EXPECTED_ACTIVE_CATEGORY_COUNT} active categories; found ${categoryCount ?? 0}`,
    );
  }

  const { count: seededServiceCount, error: serviceError } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .not("name_en", "ilike", "QA_%")
    .eq("is_active", true);
  if (serviceError) throw new Error(`[qa-e2e-baseline] failed to count seeded services: ${serviceError.message}`);
  if (seededServiceCount !== EXPECTED_SEEDED_NON_QA_SERVICE_COUNT) {
    throw new Error(
      `[qa-e2e-baseline] expected ${EXPECTED_SEEDED_NON_QA_SERVICE_COUNT} seeded non-QA services; found ${seededServiceCount ?? 0}`,
    );
  }

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw new Error(`[qa-e2e-baseline] failed to list storage buckets: ${bucketError.message}`);
  const bucketIds = new Set((buckets ?? []).map((row) => row.id));
  if (bucketIds.size !== EXPECTED_STORAGE_BUCKET_COUNT) {
    throw new Error(
      `[qa-e2e-baseline] expected ${EXPECTED_STORAGE_BUCKET_COUNT} storage buckets; found ${bucketIds.size}`,
    );
  }
  for (const bucketId of REQUIRED_STORAGE_BUCKETS) {
    if (!bucketIds.has(bucketId)) {
      throw new Error(`[qa-e2e-baseline] missing required storage bucket: ${bucketId}`);
    }
  }

  return {
    ok: true,
    settingsKeys: [...REQUIRED_SETTINGS_KEYS],
    categoryCount,
    seededServiceCount,
    storageBucketCount: bucketIds.size,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} key
 */
export async function readSettingsBaselinePresence(admin, key) {
  const { data, error } = await admin.from("settings").select("key").eq("key", key).maybeSingle();
  if (error) throw new Error(`[qa-e2e-baseline] failed to read settings key ${key}: ${error.message}`);
  return Boolean(data);
}
