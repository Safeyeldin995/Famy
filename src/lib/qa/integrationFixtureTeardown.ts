import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  IntegrationFixtureRegistry,
  type FixtureRegistrySnapshot,
} from "@/lib/qa/integrationFixtureRegistry";
// @ts-expect-error — .mjs module has no generated declarations
import { recordRecoveryFailure } from "../../../qa/registry.mjs";
// @ts-expect-error — .mjs module has no generated declarations
import { containIntegrationFixtureResidue } from "../../../qa/containment-integration.mjs";

/**
 * Tear down non-user fixture rows, then operational-contain snapshot-scoped residue.
 * Never deletes auth.users, profiles, bookings, or immutable history.
 */
export async function teardownRegisteredFixture(
  admin: SupabaseClient<Database>,
  registry: IntegrationFixtureRegistry,
  snapshot?: FixtureRegistrySnapshot,
  options?: {
    bookingRpcClient?: SupabaseClient<Database>;
  },
) {
  const state = snapshot ?? registry.snapshot();

  for (const link of state.zoneProviderLinks) {
    await admin.from("zone_providers").delete()
      .eq("zone_id", link.zoneId)
      .eq("provider_id", link.providerId);
  }
  for (const link of state.zoneServiceLinks) {
    await admin.from("zone_services").delete()
      .eq("zone_id", link.zoneId)
      .eq("service_id", link.serviceId);
  }
  for (const link of state.providerServiceLinks) {
    await admin.from("provider_services").delete()
      .eq("provider_id", link.providerId)
      .eq("service_id", link.serviceId);
  }

  if (
    state.userIds.length
    || state.bookingIds.length
    || state.serviceIds.length
    || state.providerIds.length
  ) {
    const containment = await containIntegrationFixtureResidue(admin, {
      userIds: state.userIds,
      adminUserIds: state.adminUserIds,
      serviceIds: state.serviceIds,
      providerIds: state.providerIds,
      bookingIds: state.bookingIds,
    }, {
      bookingRpcClient: options?.bookingRpcClient,
    });

    if (containment.execution) {
      for (const row of containment.execution.results) {
        if (!row.ok) {
          registry.markCleanupFailed(row.maskedId, row.entityType, row.reason ?? "containment-failed");
        }
      }
      const failed = containment.execution.aborted
        || containment.execution.results.some((row: { ok: boolean }) => !row.ok);
      if (failed) {
        const summary = containment.execution.results
          .filter((row: { ok: boolean }) => !row.ok)
          .map((row: { entityType: string; maskedId: string; actionType: string }) => `${row.entityType}:${row.maskedId}:${row.actionType}`)
          .join(", ") || containment.execution.reason || "containment-aborted";
        throw new Error(`[qa-containment] integration fixture containment incomplete: ${summary}`);
      }
    }
  }

  if (state.paymentIds.length) {
    await admin.from("payments").delete().in("id", state.paymentIds);
  }

  if (state.addressIds.length) {
    await admin.from("addresses").delete().in("id", state.addressIds);
  }

  for (const zoneId of state.zoneIds) {
    const { error } = await admin.from("zones").delete().eq("id", zoneId);
    if (error) {
      const { error: deactivateError } = await admin.from("zones").update({ is_active: false }).eq("id", zoneId);
      if (deactivateError) {
        registry.markCleanupFailed(zoneId, "zone", deactivateError.message);
        recordRecoveryFailure({
          id: zoneId,
          kind: "zone",
          reason: deactivateError.message,
          runId: registry.getRunId(),
        });
      }
    }
  }
}

/** Assert run-owned Admin users no longer hold admin roles or active auth identities. */
export async function assertRunOwnedAdminsRemoved(
  admin: SupabaseClient<Database>,
  adminUserIds: string[],
) {
  for (const userId of adminUserIds) {
    const { data: adminRoles, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin");
    if (roleError) throw roleError;
    if ((adminRoles ?? []).length > 0) {
      throw new Error(`Run-owned admin ${userId} still holds admin role after teardown`);
    }

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
    if (authError && authError.message !== "User not found") throw authError;
    const user = authData?.user;
    if (user && !user.deleted_at && !user.banned_until) {
      throw new Error(`Run-owned admin ${userId} auth identity still active after teardown`);
    }
  }
}
