import { createClient } from "@supabase/supabase-js";
import { STORAGE_BUCKETS } from "./constants.mjs";
import { SEED_SERVICE_SLUG_SET, maskId } from "./seed-catalog.mjs";
import { runSimulatedSqlTransaction } from "./execute-sql.mjs";

/** @type {readonly string[]} */
export const EXECUTE_PHASE_ORDER = ["A", "B", "B2", "C", "D", "E"];

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
async function fetchAuthUserIds(admin) {
  /** @type {string[]} */
  const ids = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    ids.push(...data.users.map((user) => user.id));
    if (data.users.length < 200) break;
  }
  return ids;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 */
async function listStorageObjectKeys(admin) {
  /** @type {Array<{ bucket: string; key: string }>} */
  const objects = [];
  for (const bucket of STORAGE_BUCKETS) {
    let offset = 0;
    for (;;) {
      const { data, error } = await admin.storage.from(bucket).list("", {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      if (!data?.length) break;
      for (const item of data) {
        if (item.id !== null) {
          objects.push({ bucket, key: item.name });
        }
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  return objects;
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

  const authUserIds = await fetchAuthUserIds(admin);
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

  const storageObjects = await listStorageObjectKeys(admin);
  phases.push({
    phase: "E",
    description: "DELETE storage objects in four buckets",
    storageObjectCount: storageObjects.length,
    maskedStorageKeys: storageObjects.slice(0, 5).map((obj) => `${obj.bucket}:${obj.key.slice(0, 4)}…`),
    simulateOnly: true,
    apiCallsSkipped: true,
  });

  assertPhaseOrder(phases.map((row) => row.phase));

  return {
    simulate: true,
    target: "qa-clone",
    phases,
    dataMutated: false,
    rollbackVerified: phases.some(
      (row) => row.simulation?.dataUnchangedVerified || row.simulation?.rolledBack === true,
    ),
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
