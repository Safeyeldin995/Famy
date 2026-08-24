/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} bucket
 * @param {string} [prefix]
 */
async function listStorageRecursive(admin, bucket, prefix = "") {
  /** @type {{ bucket: string; key: string; size: number | null }[]} */
  const objects = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`storage ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const key = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        objects.push(...(await listStorageRecursive(admin, bucket, key)));
      } else {
        objects.push({ bucket, key, size: item.metadata?.size ?? null });
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return objects;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string[]} buckets
 */
export async function inventoryStorageBuckets(admin, buckets) {
  /** @type {Record<string, { total: number; keys: { key: string; size: number | null }[] }>} */
  const out = {};
  for (const bucket of buckets) {
    const objects = await listStorageRecursive(admin, bucket);
    out[bucket] = {
      total: objects.length,
      keys: objects.map((o) => ({ key: o.key, size: o.size })),
    };
  }
  return out;
}

/**
 * @param {Set<string>} profileIds
 * @param {Set<string>} providerIds
 * @param {Set<string>} bookingIds
 */
export function classifyStorageObject(bucket, key, profileIds, providerIds, bookingIds) {
  const parts = key.split("/");
  if (bucket === "avatars") {
    const uid = parts[0];
    if (profileIds.has(uid)) return "profile_row_present";
    return "auth_only_no_profile_row";
  }
  if (bucket === "provider-documents") {
    const pid = parts[0];
    if (providerIds.has(pid)) return "provider_row_present";
    return "no_provider_row";
  }
  if (bucket === "case-evidence") {
    const bid = parts[0];
    if (bookingIds.has(bid)) return "booking_row_present";
    return "no_booking_row";
  }
  return "payment_proof_or_other";
}
