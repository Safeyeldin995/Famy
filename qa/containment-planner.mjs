import { maskUserId } from "./qa-classification.mjs";
import { isProtectedSeededCatalogRow, isQaTaggedName } from "./teardown-fk-plan.mjs";
import {
  CONTAINMENT_PLAN_VERSION,
  isQaTaggedBookingNotes,
  planBookingContainmentAction,
  QA_CONTAINMENT_REASON_CODE,
} from "./containment-booking-lifecycle.mjs";
import {
  identityNeedsContainment,
  isAuthBanned,
  isIdentityAlreadyContained,
  planIdentityContainmentActions,
} from "./containment-identity.mjs";
import { fingerprintContainmentPlan } from "./containment-fingerprint.mjs";
import { parseSupabaseProjectRef } from "./qa-identity.mjs";
import { selectBookingCaller, sanitizeBookingCallerForReport, CALLER_AUTH_MODE } from "./containment-booking-caller.mjs";

/**
 * @param {{
 *   id: string;
 *   name_en?: string | null;
 *   is_active?: boolean;
 * }} service
 */
export function planServiceContainmentAction(service) {
  if (isProtectedSeededCatalogRow(service)) {
    return { actionType: "skip", reason: "protected-seeded-service" };
  }
  if (!isQaTaggedName(service.name_en)) {
    return { actionType: "skip", reason: "not-qa-service" };
  }
  if (!service.is_active) {
    return { actionType: "noop", reason: "already-inactive" };
  }
  return {
    actionType: "deactivate_service",
    field: "services.is_active",
    from: true,
    to: false,
    preservesRow: true,
  };
}

/**
 * @param {{
 *   id: string;
 *   is_active?: boolean;
 *   vacation_mode?: boolean;
 * }} provider
 */
export function planProviderContainmentAction(provider) {
  const needsDisable = provider.is_active || !provider.vacation_mode;
  if (!needsDisable) {
    return { actionType: "noop", reason: "already-ineligible" };
  }
  return {
    actionType: "disable_provider",
    fields: {
      "providers.is_active": { from: provider.is_active ?? true, to: false },
      "providers.vacation_mode": { from: provider.vacation_mode ?? false, to: true },
    },
    preservesRow: true,
  };
}

/**
 * @param {Array<Record<string, unknown>>} plannedRows
 * @param {string} projectRef
 * @param {{
 *   identities?: Array<Record<string, unknown>>;
 *   cancellationReasonId?: string | null;
 *   standaloneBookingCaller?: boolean;
 * }} [context]
 */
export function finalizeContainmentPlan(plannedRows, projectRef, context = {}) {
  /** @type {Array<{ entityType: string; id: string; actionType: string; currentState: unknown; intendedState: unknown; maskedId: string; detail?: unknown }>} */
  const actions = [];
  /** @type {Array<{ entityType: string; maskedId: string; reason: string }>} */
  const excluded = [];

  for (const row of plannedRows) {
    if (row.kind === "excluded") {
      excluded.push({
        entityType: row.entityType,
        maskedId: maskUserId(String(row.id)),
        reason: String(row.reason),
      });
      continue;
    }

    const actionType = String(row.actionType);
    if (actionType === "skip" || actionType === "noop" || actionType === "blocked") {
      continue;
    }

    actions.push({
      entityType: String(row.entityType),
      id: String(row.id),
      maskedId: maskUserId(String(row.id)),
      actionType,
      currentState: row.currentState ?? null,
      intendedState: row.intendedState ?? null,
      detail: row.detail ?? undefined,
    });
  }

  const bookingActions = actions.filter((row) => row.actionType === "cancel_booking");
  const requiresBookingCaller = bookingActions.length > 0 && context.standaloneBookingCaller !== false;
  const callerSelection = selectBookingCaller(
    /** @type {Array<any>} */ (context.identities ?? []),
    requiresBookingCaller,
  );

  if (!callerSelection.ok) {
    return {
      version: CONTAINMENT_PLAN_VERSION,
      projectRef,
      fingerprint: null,
      blocked: true,
      blockedReason: callerSelection.blocked?.reason ?? "booking-caller-selection-failed",
      blockedDetail: callerSelection.blocked?.detail,
      bookingCaller: null,
      cancellationReasonId: context.cancellationReasonId ?? null,
      actions,
      excluded,
      counts: {
        planned_actions: actions.length,
        excluded_identities: excluded.filter((row) => row.entityType === "identity").length,
      },
    };
  }

  const bookingCaller = callerSelection.caller;
  const callerAuthMode = requiresBookingCaller ? CALLER_AUTH_MODE : null;
  const fingerprint = fingerprintContainmentPlan(
    actions.map((row) => ({
      entityType: row.entityType,
      id: row.id,
      actionType: row.actionType,
      currentState: row.currentState,
      intendedState: row.intendedState,
    })),
    projectRef,
    {
      bookingCallerUserId: bookingCaller?.userId ?? null,
      bookingCallerClass: bookingCaller?.callerClass ?? null,
      callerAuthMode,
      cancellationReasonId: context.cancellationReasonId ?? null,
      bookings: bookingActions.map((row) => ({
        id: row.id,
        status: String(row.currentState ?? ""),
      })),
    },
  );

  return {
    version: CONTAINMENT_PLAN_VERSION,
    projectRef,
    fingerprint,
    blocked: false,
    bookingCaller,
    callerAuthMode,
    cancellationReasonId: context.cancellationReasonId ?? null,
    actions,
    excluded,
    counts: {
      planned_actions: actions.length,
      excluded_identities: excluded.filter((row) => row.entityType === "identity").length,
    },
  };
}

/**
 * Build a containment plan from explicit snapshot inputs (network-free + integration).
 * @param {{
 *   projectRef?: string;
 *   identities?: Array<{
 *     userId: string;
 *     email?: string | null;
 *     fullName?: string | null;
 *     authBanned: boolean;
 *     profileSuspended: boolean;
 *     hasAdminRole: boolean;
 *     inRegistry?: boolean;
 *   }>;
 *   services?: Array<{ id: string; name_en?: string | null; is_active?: boolean }>;
 *   providers?: Array<{ id: string; is_active?: boolean; vacation_mode?: boolean }>;
 *   bookings?: Array<{ id: string; status: string; notes?: string | null; hasCancellationRecord?: boolean }>;
 *   cancellationReasonId?: string | null;
 *   standaloneBookingCaller?: boolean;
 * }} input
 */
export function buildContainmentPlanFromSnapshot(input) {
  const projectRef = input.projectRef ?? "local-test";
  /** @type {Array<Record<string, unknown>>} */
  const plannedRows = [];
  const identities = input.identities ?? [];

  for (const identity of identities) {
    if (isIdentityAlreadyContained(identity)) {
      plannedRows.push({
        kind: "excluded",
        entityType: "identity",
        id: identity.userId,
        reason: "already-contained",
      });
      continue;
    }
    if (!identityNeedsContainment(identity)) {
      continue;
    }
    const plan = planIdentityContainmentActions(identity);
    for (const action of plan.actions) {
      plannedRows.push({
        kind: "plan",
        entityType: "identity",
        id: identity.userId,
        actionType: action.actionType,
        currentState: action.from,
        intendedState: action.to,
        detail: action.field,
      });
    }
  }

  for (const service of input.services ?? []) {
    const action = planServiceContainmentAction(service);
    plannedRows.push({
      kind: "plan",
      entityType: "service",
      id: service.id,
      actionType: action.actionType,
      currentState: action.from ?? null,
      intendedState: action.to ?? null,
      detail: action.reason ?? action.field,
    });
  }

  for (const provider of input.providers ?? []) {
    const action = planProviderContainmentAction(provider);
    plannedRows.push({
      kind: "plan",
      entityType: "provider",
      id: provider.id,
      actionType: action.actionType,
      currentState: action.fields ?? null,
      intendedState: action.fields ?? null,
      detail: action.reason,
    });
  }

  for (const booking of input.bookings ?? []) {
    const action = planBookingContainmentAction({
      ...booking,
      isQaTagged: isQaTaggedBookingNotes(booking.notes),
    });
    plannedRows.push({
      kind: "plan",
      entityType: "booking",
      id: booking.id,
      actionType: action.actionType,
      currentState: booking.status,
      intendedState: action.resultingStatus ?? null,
      detail: action,
    });
  }

  return finalizeContainmentPlan(plannedRows, projectRef, {
    identities,
    cancellationReasonId: input.cancellationReasonId ?? null,
    standaloneBookingCaller: input.standaloneBookingCaller,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ userIds?: string[]; serviceIds?: string[]; providerIds?: string[]; bookingIds?: string[] }} scope
 */
export async function buildContainmentPlanFromAdmin(admin, scope = {}) {
  const projectRef = parseSupabaseProjectRef(process.env.QA_SUPABASE_URL ?? "");

  /** @type {string[]} */
  const identityIds = scope.userIds ?? [];
  if (!identityIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,full_name,is_suspended")
      .or("full_name.ilike.QA_%,full_name.ilike.qa-%");
    for (const profile of profiles ?? []) identityIds.push(profile.id);
  }

  /** @type {Array<Awaited<ReturnType<typeof buildIdentityState>>>} */
  const identities = [];
  for (const userId of identityIds) {
    identities.push(await buildIdentityState(admin, userId));
  }

  let services = [];
  if (scope.serviceIds?.length) {
    const { data } = await admin.from("services").select("id,name_en,is_active").in("id", scope.serviceIds);
    services = data ?? [];
  } else {
    const { data } = await admin.from("services").select("id,name_en,is_active").ilike("name_en", "QA_%").eq("is_active", true);
    services = data ?? [];
  }

  let providers = [];
  if (scope.providerIds?.length) {
    const { data } = await admin.from("providers").select("id,is_active,vacation_mode").in("id", scope.providerIds);
    providers = data ?? [];
  } else if (scope.providerIds) {
    providers = [];
  } else {
    const qaProfileIds = identities.map((row) => row.userId);
    if (qaProfileIds.length) {
      const { data } = await admin
        .from("providers")
        .select("id,is_active,vacation_mode")
        .in("profile_id", qaProfileIds);
      providers = data ?? [];
    }
  }

  let bookings = [];
  if (scope.bookingIds?.length) {
    const { data } = await admin.from("bookings").select("id,status,notes").in("id", scope.bookingIds);
    bookings = await enrichBookingsWithCancellationFlag(admin, data ?? []);
  } else {
    const { data } = await admin
      .from("bookings")
      .select("id,status,notes")
      .ilike("notes", "QA_%")
      .in("status", ["pending", "confirmed", "in_progress"]);
    bookings = await enrichBookingsWithCancellationFlag(admin, data ?? []);
  }

  let cancellationReasonId = null;
  const pendingBookingActions = [];
  for (const booking of bookings) {
    const action = planBookingContainmentAction({
      ...booking,
      isQaTagged: isQaTaggedBookingNotes(booking.notes),
    });
    if (action.actionType === "cancel_booking") {
      pendingBookingActions.push(booking);
    }
  }
  if (pendingBookingActions.length) {
    cancellationReasonId = await resolveCancellationReasonId(admin, QA_CONTAINMENT_REASON_CODE);
  }

  return buildContainmentPlanFromSnapshot({
    projectRef,
    identities,
    services,
    providers,
    bookings,
    cancellationReasonId,
    standaloneBookingCaller: true,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} userId
 */
async function buildIdentityState(admin, userId) {
  const [{ data: authData }, { data: profile }, { data: roles }] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name,is_suspended").eq("id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const user = authData?.user;
  return {
    userId,
    email: user?.email ?? null,
    fullName: profile?.full_name ?? null,
    authBanned: isAuthBanned(user?.banned_until, user?.ban_duration),
    profileSuspended: profile?.is_suspended === true,
    hasAdminRole: (roles ?? []).some((row) => row.role === "admin"),
    inRegistry: false,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Array<{ id: string; status: string; notes?: string | null }>} bookings
 */
async function enrichBookingsWithCancellationFlag(admin, bookings) {
  if (!bookings.length) return [];
  const ids = bookings.map((row) => row.id);
  const { data: cancellations } = await admin
    .from("booking_cancellations")
    .select("booking_id")
    .in("booking_id", ids);
  const cancelled = new Set((cancellations ?? []).map((row) => row.booking_id));
  return bookings.map((row) => ({
    ...row,
    hasCancellationRecord: cancelled.has(row.id),
  }));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} code
 */
async function resolveCancellationReasonId(admin, code) {
  const { data, error } = await admin
    .from("cancellation_reasons")
    .select("id")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * @param {ReturnType<typeof finalizeContainmentPlan>} plan
 */
export function sanitizeContainmentPlanForReport(plan) {
  return {
    version: plan.version,
    projectRef: plan.projectRef,
    fingerprint: plan.fingerprint,
    blocked: plan.blocked ?? false,
    blockedReason: plan.blockedReason ?? null,
    bookingCaller: sanitizeBookingCallerForReport(plan.bookingCaller),
    callerAuthMode: plan.callerAuthMode ?? null,
    cancellationReasonId: plan.cancellationReasonId ?? null,
    counts: plan.counts,
    actions: plan.actions.map((row) => ({
      entityType: row.entityType,
      maskedId: row.maskedId,
      actionType: row.actionType,
      currentState: row.currentState,
      intendedState: row.intendedState,
    })),
    excluded: plan.excluded,
  };
}
