import { createClient } from "@supabase/supabase-js";
import { STORAGE_BUCKETS } from "./constants.mjs";
import { SEED_SERVICE_SLUG_SET, maskId } from "./seed-catalog.mjs";
import { fetchAllAuthUserIds } from "./plan.mjs";
import { inventoryStorageBuckets } from "./storage-inventory.mjs";
import { runSimulatedSqlTransaction } from "./execute-sql.mjs";

/** @type {readonly string[]} */
export const EXECUTE_PHASE_ORDER = ["A", "B", "B2", "C", "D", "E"];

/** SQL phases that must each prove rollback via row-count verification. */
export const SQL_SIMULATION_PHASES = ["A", "B2", "D"];

/**
 * @param {{ phaseA: { truncateRoots: string[] } }} plan
 */
export function buildPhaseATruncateStatement(plan) {
  const tables = plan.phaseA.truncateRoots.map((table) => `public.${table}`).join(", ");
  return `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`;
}

export function buildAuditLogsTruncateStatement() {
  return "TRUNCATE TABLE public.audit_logs RESTART IDENTITY";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 */
async function fetchDeleteServiceIds(admin) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("services").select("id, slug").range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data.filter((row) => !SEED_SERVICE_SLUG_SET.has(row.slug)));
    if (data.length < 1000) break;
  }
  return rows.map((row) => row.id);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 */
export async function collectStorageObjectKeys(admin) {
  const inventory = await inventoryStorageBuckets(admin, STORAGE_BUCKETS);
  return STORAGE_BUCKETS.flatMap((bucket) =>
    inventory[bucket].keys.map((obj) => ({ bucket, key: obj.key })),
  );
}

/**
 * @param {Array<Record<string, unknown>>} phases
 * @param {boolean} databaseUrlConfigured
 */
export function computeRollbackVerified(phases, databaseUrlConfigured) {
  if (!databaseUrlConfigured) {
    return {
      rollbackVerified: false,
      rollbackVerificationNote: "no-database-url — SQL phases ran in plan-only mode",
    };
  }

  const sqlPhases = phases.filter((row) => SQL_SIMULATION_PHASES.includes(String(row.phase)));
  const observedNames = sqlPhases.map((row) => String(row.phase));
  const expectedSet = new Set(SQL_SIMULATION_PHASES);
  const observedSet = new Set(observedNames);
  const hasExactPhases =
    observedNames.length === SQL_SIMULATION_PHASES.length &&
    observedSet.size === SQL_SIMULATION_PHASES.length &&
    SQL_SIMULATION_PHASES.every((phase) => observedSet.has(phase));

  if (!hasExactPhases) {
    const missing = SQL_SIMULATION_PHASES.filter((phase) => !observedSet.has(phase));
    const duplicates = SQL_SIMULATION_PHASES.filter(
      (phase) => observedNames.filter((name) => name === phase).length > 1,
    );
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.join(", ")}`);
    if (duplicates.length) parts.push(`duplicate ${duplicates.join(", ")}`);
    return {
      rollbackVerified: false,
      rollbackVerificationNote: `SQL rollback phases incomplete — ${parts.join("; ") || "expected A, B2, D exactly once"}`,
    };
  }

  const allVerified = sqlPhases.every((row) => row.simulation?.dataUnchangedVerified === true);
  if (allVerified) {
    return { rollbackVerified: true, rollbackVerificationNote: null };
  }

  const unverified = sqlPhases
    .filter((row) => row.simulation?.dataUnchangedVerified !== true)
    .map((row) => row.phase);
  return {
    rollbackVerified: false,
    rollbackVerificationNote: `SQL phases lacking row-count rollback proof: ${unverified.join(", ")}`,
  };
}

/**
 * @param {Awaited<import("./plan.mjs").buildProductionResetPlan>} plan
 * @param {{ url: string; serviceRoleKey: string; databaseUrl?: string | null }} env
 * @param {{ execSql?: (databaseUrl: string, sql: string) => void; captureCounts?: () => Promise<Record<string, number>>; verifyCounts?: (before: Record<string, number>, after: Record<string, number>) => void }} [deps]
 */
export async function runSimulatedExecutePhases(plan, env, deps = {}) {
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /** @type {Array<Record<string, unknown>>} */
  const phases = [];

  const phaseASql = buildPhaseATruncateStatement(plan);
  const phaseARowCounts = plan.phaseA.truncateCascadeClosure.map((table) => ({
    table,
    rows: plan.counts.tableCounts[table] ?? 0,
  }));
  const phaseA = await runSimulatedSqlTransaction(env.databaseUrl ?? null, [phaseASql], deps);
  phases.push({
    phase: "A",
    description: "TRUNCATE Phase A roots CASCADE",
    sql: phaseASql,
    tablesInClosure: plan.phaseA.truncateCascadeClosure.length,
    rowCounts: phaseARowCounts,
    simulation: phaseA,
  });

  const deleteServiceIds = await fetchDeleteServiceIds(admin);
  phases.push({
    phase: "B",
    description: "DELETE non-seed services (trg_audit_services)",
    serviceDeleteCount: deleteServiceIds.length,
    maskedServiceDeleteIds: deleteServiceIds.slice(0, 5).map(maskId),
    simulateOnly: true,
    apiCallsSkipped: true,
  });

  const phaseB2Sql = buildAuditLogsTruncateStatement();
  const phaseB2 = await runSimulatedSqlTransaction(env.databaseUrl ?? null, [phaseB2Sql], deps);
  phases.push({
    phase: "B2",
    description: "TRUNCATE audit_logs before auth delete",
    sql: phaseB2Sql,
    auditLogsRows: plan.counts.tableCounts.audit_logs ?? 0,
    simulation: phaseB2,
  });

  const authUserIds = await fetchAllAuthUserIds(admin);
  phases.push({
    phase: "C",
    description: "DELETE auth.users via Auth Admin API",
    authUsersDeleteCount: authUserIds.length,
    maskedAuthUserIds: authUserIds.slice(0, 5).map(maskId),
    simulateOnly: true,
    apiCallsSkipped: true,
  });

  const phaseDSql = buildAuditLogsTruncateStatement();
  const phaseD = await runSimulatedSqlTransaction(env.databaseUrl ?? null, [phaseDSql], deps);
  phases.push({
    phase: "D",
    description: "TRUNCATE audit_logs safety-net clear",
    sql: phaseDSql,
    simulation: phaseD,
  });

  const storageObjects = await collectStorageObjectKeys(admin);
  phases.push({
    phase: "E",
    description: "DELETE storage objects in four buckets",
    storageObjectCount: storageObjects.length,
    maskedStorageKeys: storageObjects.slice(0, 5).map((obj) => `${obj.bucket}:${obj.key.slice(0, 4)}…`),
    simulateOnly: true,
    apiCallsSkipped: true,
  });

  assertPhaseOrder(phases.map((row) => row.phase));

  const rollback = computeRollbackVerified(phases, Boolean(env.databaseUrl));

  return {
    simulate: true,
    target: "qa-clone",
    phases,
    dataMutated: false,
    rollbackVerified: rollback.rollbackVerified,
    rollbackVerificationNote: rollback.rollbackVerificationNote,
  };
}

/**
 * @param {string[]} observed
 */
export function assertPhaseOrder(observed) {
  const expected = [...EXECUTE_PHASE_ORDER];
  if (observed.length !== expected.length || observed.some((phase, index) => phase !== expected[index])) {
    throw new Error(
      `[production-reset:execute] Phase order mismatch — expected ${expected.join("→")}, got ${observed.join("→")}`,
    );
  }
}
