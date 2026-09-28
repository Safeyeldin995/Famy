/**
 * Fail-closed PR67 babysitting teardown resume.
 * Stage 2: load the pending dry-run file and an owner-supplied fingerprint.
 * Never seeds fixtures. Never auto-approves the pending file's own fingerprint.
 * Default is verify (rebuild current plan, zero writes). Execute requires
 * --execute --confirm=I-UNDERSTAND-QA-CONTAINMENT plus the reviewed fingerprint.
 */
import { loadQaEnv } from "./load-qa-env.mjs";
import { runPreflightChecks } from "./env-guard.mjs";
import { getSupabaseAdmin } from "./admin-client.mjs";
import { runCliIfDirect } from "./cli-entrypoint.mjs";
import {
  buildIntegrationContainmentPlan,
  containIntegrationFixtureResidue,
} from "./containment-integration.mjs";
import { authenticateBookingCaller } from "./containment-booking-caller.mjs";
import { recordRecoveryFailure } from "./registry.mjs";
import {
  assertApprovedExecutablePlan,
  assertOwnerApprovedTeardown,
  buildBabysittingTeardownPlan,
  containmentSnapshotFrom,
  fingerprintBabysittingTeardownPlan,
  loadPendingTeardown,
  parseBabysittingTeardownResumeArgs,
} from "./babysitting-teardown-plan.mjs";

/**
 * Snapshot-scoped writes used by the resume CLI after approval.
 * Same link/row deletes and approvedPlan containment path as
 * teardownRegisteredFixture — invoked only after executable-plan integrity.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {object} snapshot
 * @param {object} executablePlan
 * @param {string} expectedFingerprint
 * @param {import("@supabase/supabase-js").SupabaseClient | undefined} bookingRpcClient
 * @param {{ markCleanupFailed?: (id: string, kind: string, reason: string) => void; runId?: string }} [registry]
 */
export async function executeApprovedBabysittingSnapshotTeardown(
  admin,
  snapshot,
  executablePlan,
  expectedFingerprint,
  bookingRpcClient,
  registry = {},
) {
  assertApprovedExecutablePlan(executablePlan, expectedFingerprint);

  for (const link of snapshot.zoneProviderLinks ?? []) {
    await admin
      .from("zone_providers")
      .delete()
      .eq("zone_id", link.zoneId)
      .eq("provider_id", link.providerId);
  }
  for (const link of snapshot.zoneServiceLinks ?? []) {
    await admin
      .from("zone_services")
      .delete()
      .eq("zone_id", link.zoneId)
      .eq("service_id", link.serviceId);
  }
  for (const link of snapshot.providerServiceLinks ?? []) {
    await admin
      .from("provider_services")
      .delete()
      .eq("provider_id", link.providerId)
      .eq("service_id", link.serviceId);
  }

  if (
    (snapshot.userIds ?? []).length ||
    (snapshot.bookingIds ?? []).length ||
    (snapshot.serviceIds ?? []).length ||
    (snapshot.providerIds ?? []).length
  ) {
    const containment = await containIntegrationFixtureResidue(
      admin,
      containmentSnapshotFrom(snapshot),
      {
        bookingRpcClient,
        approvedPlan: executablePlan,
        expectedFingerprint,
      },
    );

    if (containment.execution) {
      for (const row of containment.execution.results) {
        if (!row.ok) {
          registry.markCleanupFailed?.(
            row.maskedId,
            row.entityType,
            row.reason ?? "containment-failed",
          );
        }
      }
      const failed =
        containment.execution.aborted || containment.execution.results.some((row) => !row.ok);
      if (failed) {
        const summary =
          containment.execution.results
            .filter((row) => !row.ok)
            .map((row) => `${row.entityType}:${row.maskedId}:${row.actionType}`)
            .join(", ") ||
          containment.execution.reason ||
          "containment-aborted";
        throw new Error(`[qa-containment] integration fixture containment incomplete: ${summary}`);
      }
    }
  }

  if ((snapshot.paymentIds ?? []).length) {
    await admin.from("payments").delete().in("id", snapshot.paymentIds);
  }

  if ((snapshot.addressIds ?? []).length) {
    await admin.from("addresses").delete().in("id", snapshot.addressIds);
  }

  for (const zoneId of snapshot.zoneIds ?? []) {
    const { error } = await admin.from("zones").delete().eq("id", zoneId);
    if (error) {
      const { error: deactivateError } = await admin
        .from("zones")
        .update({ is_active: false })
        .eq("id", zoneId);
      if (deactivateError) {
        registry.markCleanupFailed?.(zoneId, "zone", deactivateError.message);
        recordRecoveryFailure({
          id: zoneId,
          kind: "zone",
          reason: deactivateError.message,
          runId: registry.runId ?? registry.getRunId?.(),
        });
      }
    }
  }
}

export async function rebuildCurrentBabysittingTeardownPlan(admin, reviewedPlan) {
  const currentContainment = await buildIntegrationContainmentPlan(
    admin,
    containmentSnapshotFrom(reviewedPlan.snapshot),
  );
  return buildBabysittingTeardownPlan(reviewedPlan.snapshot, currentContainment);
}

async function resolveBookingRpcClient(admin, reviewedPlan) {
  const bookingIds = reviewedPlan.snapshot.bookingIds ?? [];
  if (!bookingIds.length) return undefined;
  const callerUserId = reviewedPlan.containment.plan?.bookingCaller?.userId;
  if (!callerUserId) {
    throw new Error(
      "[qa-containment] babysitting fixture teardown requires bookingRpcClient before pending-booking cancel",
    );
  }
  const auth = await authenticateBookingCaller(admin, callerUserId);
  if (!auth.ok || !auth.rpcClient) {
    throw new Error(
      `[qa-containment] babysitting fixture teardown requires bookingRpcClient before pending-booking cancel (${auth.reason ?? "caller-authentication-failed"})`,
    );
  }
  return auth.rpcClient;
}

/**
 * Operational resume. Always rebuilds the current plan from live snapshot IDs
 * (no currentPlan / rebuild injection). Fail-closed on missing approval or drift.
 * @param {{
 *   mode: "verify" | "execute";
 *   pending: ReturnType<typeof parsePendingTeardown>;
 *   ownerFingerprint: string;
 *   admin: import("@supabase/supabase-js").SupabaseClient;
 *   bookingRpcClient?: import("@supabase/supabase-js").SupabaseClient;
 * }} args
 */
export async function resumeBabysittingTeardownFromPending(args) {
  const ownerFingerprint = args.ownerFingerprint;
  if (!ownerFingerprint) {
    throw new Error(
      "[qa-containment] babysitting teardown requires owner-approved plan fingerprint from a reviewed dry-run",
    );
  }
  assertOwnerApprovedTeardown({
    approval: { fingerprint: ownerFingerprint, plan: args.pending.plan },
    currentPlan: args.pending.plan,
  });

  const currentPlan = await rebuildCurrentBabysittingTeardownPlan(args.admin, args.pending.plan);
  assertOwnerApprovedTeardown({
    approval: { fingerprint: ownerFingerprint, plan: args.pending.plan },
    currentPlan,
  });

  if (args.mode !== "execute") {
    return {
      mode: "verify",
      writesPerformed: false,
      residueActive: true,
      fingerprint: ownerFingerprint,
      currentFingerprint: fingerprintBabysittingTeardownPlan(currentPlan),
    };
  }

  const bookingRpcClient =
    args.bookingRpcClient ?? (await resolveBookingRpcClient(args.admin, args.pending.plan));

  if ((args.pending.plan.snapshot.bookingIds ?? []).length && !bookingRpcClient) {
    throw new Error(
      "[qa-containment] babysitting fixture teardown requires bookingRpcClient before pending-booking cancel",
    );
  }

  await executeApprovedBabysittingSnapshotTeardown(
    args.admin,
    args.pending.plan.snapshot,
    args.pending.plan.containment.plan,
    args.pending.plan.containment.fingerprint,
    bookingRpcClient,
  );

  return {
    mode: "execute",
    writesPerformed: true,
    residueActive: false,
    fingerprint: ownerFingerprint,
  };
}

function printVerifySummary(pending, ownerFingerprint, currentFingerprint) {
  const payload = {
    status: pending.status,
    residueActive: pending.residueActive,
    automaticContainmentIsReadOnly: pending.automaticContainmentIsReadOnly,
    writesPerformed: false,
    pendingFingerprint: pending.fingerprint,
    currentFingerprint: currentFingerprint ?? null,
    ownerFingerprint: ownerFingerprint ?? null,
    matched:
      Boolean(ownerFingerprint) &&
      ownerFingerprint === pending.fingerprint &&
      ownerFingerprint === currentFingerprint,
    resume:
      "This verify pass performed zero teardown writes. Residue remains active. Do not rerun the mutating suite. Execute only with an owner-approved reviewed fingerprint.",
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseBabysittingTeardownResumeArgs(argv, env);
  if (parsed.mode === "rejected") {
    console.error(`[qa-containment] ${parsed.error}`);
    return 1;
  }

  try {
    loadQaEnv({ required: true });
    runPreflightChecks(env ?? process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let pending;
  try {
    pending = loadPendingTeardown(parsed.pendingFile);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const admin = getSupabaseAdmin();
    if (parsed.mode === "verify" && !parsed.planFingerprint) {
      const currentPlan = await rebuildCurrentBabysittingTeardownPlan(admin, pending.plan);
      const currentFingerprint = fingerprintBabysittingTeardownPlan(currentPlan);
      printVerifySummary(pending, null, currentFingerprint);
      if (currentFingerprint !== pending.fingerprint) {
        console.error(
          "[qa-containment] teardown plan drifted from the owner-approved fingerprint — rebuild dry-run and re-approve",
        );
        return 1;
      }
      return 0;
    }

    const result = await resumeBabysittingTeardownFromPending({
      mode: parsed.mode,
      pending,
      ownerFingerprint: parsed.planFingerprint,
      admin,
    });
    if (result.mode === "verify") {
      printVerifySummary(pending, parsed.planFingerprint, result.currentFingerprint);
    } else {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "executed",
            fingerprint: result.fingerprint,
            writesPerformed: true,
          },
          null,
          2,
        )}\n`,
      );
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

runCliIfDirect(import.meta.url, () => main());
