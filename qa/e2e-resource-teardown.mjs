/**
 * Snapshot-scoped E2E resource teardown — current-run IDs only, no global QA scan.
 */
import { maskUserId } from "./qa-classification.mjs";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} zoneId
 */
export async function teardownSnapshotZone(admin, zoneId) {
  await admin.from("zone_providers").delete().eq("zone_id", zoneId);
  await admin.from("zone_services").delete().eq("zone_id", zoneId);
  const { error: deleteError } = await admin.from("zones").delete().eq("id", zoneId);
  if (!deleteError) {
    return { id: zoneId, action: "deleted", reason: null };
  }
  const { error: deactivateError } = await admin.from("zones").update({ is_active: false }).eq("id", zoneId);
  if (deactivateError) {
    return { id: zoneId, action: "failed", reason: `${deleteError.message}; deactivate: ${deactivateError.message}` };
  }
  return { id: zoneId, action: "deactivated", reason: deleteError.message };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} serviceId
 */
export async function teardownSnapshotService(admin, serviceId) {
  await admin.from("zone_services").delete().eq("service_id", serviceId);
  await admin.from("provider_services").delete().eq("service_id", serviceId);
  const { error: deactivateError } = await admin.from("services").update({ is_active: false }).eq("id", serviceId);
  if (deactivateError) {
    return { id: serviceId, action: "failed", reason: deactivateError.message };
  }
  const { error: deleteError } = await admin.from("services").delete().eq("id", serviceId);
  if (deleteError) {
    return { id: serviceId, action: "deactivated", reason: deleteError.message };
  }
  return { id: serviceId, action: "deleted", reason: null };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ zoneIds?: string[]; serviceIds?: string[]; bookingIds?: string[]; providerIds?: string[] }} resources
 */
export async function runE2eSnapshotResourceTeardown(admin, resources) {
  /** @type {Array<{ table: string; id: string; action: string; reason: string | null }>} */
  const outcomes = [];

  for (const zoneId of resources.zoneIds ?? []) {
    const result = await teardownSnapshotZone(admin, zoneId);
    outcomes.push({ table: "zones", ...result });
    if (result.action === "failed") {
      console.error(`[qa-teardown:e2e-resource] zone ${maskUserId(zoneId)} ${result.action}: ${result.reason}`);
    }
  }

  for (const serviceId of resources.serviceIds ?? []) {
    const result = await teardownSnapshotService(admin, serviceId);
    outcomes.push({ table: "services", ...result });
    if (result.action === "failed") {
      console.error(`[qa-teardown:e2e-resource] service ${maskUserId(serviceId)} ${result.action}: ${result.reason}`);
    }
  }

  for (const bookingId of resources.bookingIds ?? []) {
    const { error } = await admin.from("bookings").delete().eq("id", bookingId);
    outcomes.push({
      table: "bookings",
      id: bookingId,
      action: error ? "failed" : "deleted",
      reason: error?.message ?? null,
    });
    if (error) {
      console.error(`[qa-teardown:e2e-resource] booking ${maskUserId(bookingId)} failed: ${error.message}`);
    }
  }

  for (const providerId of resources.providerIds ?? []) {
    const { error } = await admin.from("providers").update({ is_active: false, vacation_mode: true }).eq("id", providerId);
    outcomes.push({
      table: "providers",
      id: providerId,
      action: error ? "failed" : "deactivated",
      reason: error?.message ?? null,
    });
    if (error) {
      console.error(`[qa-teardown:e2e-resource] provider ${maskUserId(providerId)} failed: ${error.message}`);
    }
  }

  return {
    outcomes,
    failed: outcomes.filter((row) => row.action === "failed"),
    deactivated: outcomes.filter((row) => row.action === "deactivated"),
    deleted: outcomes.filter((row) => row.action === "deleted"),
  };
}
