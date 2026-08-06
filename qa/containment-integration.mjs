/**
 * Integration-scoped operational containment for newly-created fixture residue.
 * Never scans or mutates the 35+ already-contained historical identities.
 */
import { mergeRegistryState } from "./registry.mjs";
import { buildContainmentPlanFromSnapshot } from "./containment-planner.mjs";
import { executeContainmentPlan } from "./containment-core.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { isAuthBanned } from "./containment-identity.mjs";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{
 *   userIds: string[];
 *   adminUserIds?: string[];
 *   serviceIds?: string[];
 *   providerIds?: string[];
 *   bookingIds?: string[];
 * }} snapshot
 */
export async function buildIntegrationContainmentPlan(admin, snapshot) {
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL);
  const registryUsers = new Map((mergeRegistryState().users ?? []).map((row) => [row.userId, row]));

  /** @type {Array<Awaited<ReturnType<typeof buildIdentitySnapshotRow>>>} */
  const identities = [];
  for (const userId of snapshot.userIds ?? []) {
    identities.push(await buildIdentitySnapshotRow(admin, userId, {
      inRegistry: registryUsers.has(userId),
      isAdmin: (snapshot.adminUserIds ?? []).includes(userId),
    }));
  }

  let services = [];
  if (snapshot.serviceIds?.length) {
    const { data } = await admin.from("services").select("id,name_en,is_active").in("id", snapshot.serviceIds);
    services = data ?? [];
  }

  let providers = [];
  if (snapshot.providerIds?.length) {
    const { data } = await admin.from("providers").select("id,is_active,vacation_mode").in("id", snapshot.providerIds);
    providers = data ?? [];
  }

  let bookings = [];
  if (snapshot.bookingIds?.length) {
    const { data } = await admin.from("bookings").select("id,status,notes").in("id", snapshot.bookingIds);
    const ids = (data ?? []).map((row) => row.id);
    const { data: cancellations } = ids.length
      ? await admin.from("booking_cancellations").select("booking_id").in("booking_id", ids)
      : { data: [] };
    const cancelled = new Set((cancellations ?? []).map((row) => row.booking_id));
    bookings = (data ?? []).map((row) => ({
      ...row,
      hasCancellationRecord: cancelled.has(row.id),
    }));
  }

  return buildContainmentPlanFromSnapshot({
    projectRef,
    identities,
    services,
    providers,
    bookings,
    standaloneBookingCaller: false,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 * @param {{ inRegistry?: boolean; isAdmin?: boolean }} hints
 */
async function buildIdentitySnapshotRow(admin, userId, hints) {
  const [{ data: authData }, { data: profile }, { data: roles }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name,is_suspended").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const user = authData?.user;
  const hasAdminRole = hints.isAdmin || (roles ?? []).some((row) => row.role === "admin");
  return {
    userId,
    email: user?.email ?? null,
    fullName: profile?.full_name ?? null,
    authBanned: isAuthBanned(user?.banned_until, user?.ban_duration),
    profileSuspended: profile?.is_suspended === true,
    hasAdminRole,
    inRegistry: hints.inRegistry ?? false,
  };
}

/**
 * Contain only snapshot-scoped integration residue; never delete auth/profile rows.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{
 *   userIds: string[];
 *   adminUserIds?: string[];
 *   serviceIds?: string[];
 *   providerIds?: string[];
 *   bookingIds?: string[];
 * }} snapshot
 * @param {{ bookingRpcClient?: import('@supabase/supabase-js').SupabaseClient; dryRun?: boolean }} [options]
 */
export async function containIntegrationFixtureResidue(admin, snapshot, options = {}) {
  const plan = await buildIntegrationContainmentPlan(admin, snapshot);
  if (options.dryRun) {
    return { plan, execution: null };
  }

  const needsBookingClient = plan.actions.some((row) => row.actionType === "cancel_booking");
  if (needsBookingClient && !options.bookingRpcClient) {
    throw new Error("[qa-containment] integration requires bookingRpcClient before booking mutation");
  }

  const execution = await executeContainmentPlan(admin, plan, {
    bookingRpcClient: options.bookingRpcClient,
    integrationMode: true,
  });
  return { plan, execution };
}

/**
 * @param {ReturnType<typeof buildIntegrationContainmentPlan> extends Promise<infer P> ? P : never} plan
 */
export function summarizeIntegrationContainment(plan) {
  return {
    plannedActions: plan.counts.planned_actions,
    excludedIdentities: plan.counts.excluded_identities,
    immutableHistoryUntouched: true,
    fingerprint: plan.fingerprint,
  };
}
