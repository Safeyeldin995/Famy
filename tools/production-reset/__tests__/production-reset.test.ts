import { describe, expect, it, vi } from "vitest";
import { parseProductionResetArgs } from "../args.mjs";
import {
  RESET_CONFIRM_VALUE,
  PRODUCTION_PROJECT_REF,
  PHASE_A_TRUNCATE_ROOTS,
  EXECUTE_TARGET_QA_CLONE,
  EXECUTE_TARGET_PRODUCTION,
} from "../constants.mjs";
import { evaluateCatalogBlockingChecks, EXPECTED_SEED_SERVICE_COUNT } from "../blocking-predicates.mjs";
import { computeTruncateCascadeClosure } from "../fk-closure.mjs";
import {
  loadPublicFkEdges,
  loadFkEdgesFromMigrations,
  parseFkEdgesFromSqlFragment,
} from "../fk-graph.mjs";
import {
  assertMigrationFkGraphComplete,
  assertPhaseAClosureComplete,
  validateMigrationFkGraphAndClosure,
} from "../fk-graph-validation.mjs";
import {
  fingerprintPlan,
  fingerprintFkEdges,
  fingerprintStorageObjectKeys,
} from "../fingerprint.mjs";
import { resolveLinkedSupabaseProjectRef } from "../linked-project-ref.mjs";
import { loadProductionEnv } from "../load-production-env.mjs";
import {
  assertTableCountsKeysMatchPhaseAClosure,
  buildPhaseATableRowCounts,
  buildProductionResetPlanFromSnapshot,
  dryRunExitCode,
  sanitizePlanForReport,
} from "../plan.mjs";
import { SEED_SERVICE_SLUGS } from "../seed-catalog.mjs";
import { KNOWN_QA_PROJECT_REF } from "../../../qa/qa-identity.mjs";
import {
  assertExecuteTargetAllowed,
  assertLiveFingerprintMatches,
  assertSimulateModeRequired,
  runProductionResetExecute,
} from "../execute.mjs";
import { assertCountsUnchanged, runSimulatedSqlTransaction } from "../execute-sql.mjs";
import { assertPhaseOrder, EXECUTE_PHASE_ORDER } from "../execute-phases.mjs";

const SYNTHETIC_EDGES = [
  { child: "payments", parent: "bookings", parentSchema: "public", onDelete: "CASCADE" },
  { child: "messages", parent: "bookings", parentSchema: "public", onDelete: "CASCADE" },
  { child: "bookings", parent: "profiles", parentSchema: "public", onDelete: "RESTRICT" },
  { child: "provider_services", parent: "providers", parentSchema: "public", onDelete: "CASCADE" },
  { child: "providers", parent: "profiles", parentSchema: "public", onDelete: "CASCADE" },
  { child: "audit_logs", parent: "users", parentSchema: "auth", onDelete: "NO ACTION" },
  { child: "user_roles", parent: "users", parentSchema: "auth", onDelete: "CASCADE" },
];

function seedServicesFixture() {
  return SEED_SERVICE_SLUGS.map((slug, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug,
    name_en: `Seed ${slug}`,
  }));
}

function qaDeleteServicesFixture(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug: `qa-service-${index + 1}`,
    name_en: `QA_Service ${index + 1}`,
  }));
}

function qaZonesFixture(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name_en: `QA_Zone ${index + 1}`,
  }));
}

function phaseAClosureFixture() {
  return computeTruncateCascadeClosure(loadFkEdgesFromMigrations(), [...PHASE_A_TRUNCATE_ROOTS]);
}

function phaseATableCountsFixture(overrides: Record<string, number> = {}) {
  return buildPhaseATableRowCounts(phaseAClosureFixture(), {
    audit_logs: 1,
    bookings: 1,
    zone_services: 0,
    ...overrides,
  });
}

function validSnapshot(overrides = {}) {
  const services = [...seedServicesFixture(), ...qaDeleteServicesFixture()];
  const zones = qaZonesFixture();
  const deleteServiceIds = services.filter((s) => !SEED_SERVICE_SLUGS.includes(s.slug)).map((s) => s.id);
  return {
    projectRef: PRODUCTION_PROJECT_REF,
    fkGraphSource: "migrations",
    linkedRefVerified: false,
    edges: loadFkEdgesFromMigrations(),
    services,
    zones,
    serviceRequirements: deleteServiceIds.map((serviceId, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      service_id: serviceId,
    })),
    authUserIds: ["40000000-0000-4000-8000-000000000001"],
    storageObjects: [{ bucket: "avatars", key: "40000000-0000-4000-8000-000000000001/photo.jpg" }],
    tableCounts: phaseATableCountsFixture(),
    ...overrides,
  };
}

function validExecuteArgs(fingerprint = "a".repeat(64)) {
  return [
    "--execute",
    "--simulate",
    `--target=${EXECUTE_TARGET_QA_CLONE}`,
    `--confirm=${RESET_CONFIRM_VALUE}`,
    `--plan-fingerprint=${fingerprint}`,
  ];
}

function qaCloneEnvFixture() {
  return {
    url: `https://${KNOWN_QA_PROJECT_REF}.supabase.co`,
    serviceRoleKey: "test-secret-key",
    projectRef: KNOWN_QA_PROJECT_REF,
    databaseUrl: null,
    maskedProjectRef: `${KNOWN_QA_PROJECT_REF.slice(0, 4)}…${KNOWN_QA_PROJECT_REF.slice(-4)}`,
  };
}

describe("production reset args", () => {
  it("defaults to dry-run with no flags", () => {
    expect(parseProductionResetArgs([])).toEqual({ mode: "dry-run" });
  });

  it("rejects --force", () => {
    expect(parseProductionResetArgs(["--force"]).mode).toBe("rejected");
  });

  it("rejects incomplete execute combinations", () => {
    expect(parseProductionResetArgs(["--execute"]).mode).toBe("rejected");
    expect(
      parseProductionResetArgs(["--execute", `--confirm=${RESET_CONFIRM_VALUE}`]).mode,
    ).toBe("rejected");
    expect(
      parseProductionResetArgs([
        "--execute",
        `--confirm=${RESET_CONFIRM_VALUE}`,
        `--plan-fingerprint=${"a".repeat(64)}`,
        `--target=${EXECUTE_TARGET_QA_CLONE}`,
      ]).mode,
    ).toBe("rejected");
  });

  it("rejects execute without --simulate", () => {
    expect(
      parseProductionResetArgs([
        "--execute",
        `--target=${EXECUTE_TARGET_QA_CLONE}`,
        `--confirm=${RESET_CONFIRM_VALUE}`,
        `--plan-fingerprint=${"a".repeat(64)}`,
      ]).mode,
    ).toBe("rejected");
  });

  it("accepts full QA-clone simulate execute combo", () => {
    expect(parseProductionResetArgs(validExecuteArgs()).mode).toBe("execute");
  });

  it("allows dry-run with --target=qa-clone", () => {
    expect(parseProductionResetArgs([`--target=${EXECUTE_TARGET_QA_CLONE}`]).mode).toBe("dry-run");
  });

  it("dry-run ignores fingerprint-only", () => {
    expect(
      parseProductionResetArgs([`--plan-fingerprint=${"b".repeat(64)}`]).mode,
    ).toBe("dry-run");
  });
});

describe("execute gates", () => {
  it("rejects --target=production unconditionally", () => {
    expect(() => assertExecuteTargetAllowed(EXECUTE_TARGET_PRODUCTION)).toThrow(
      /not available/i,
    );
    expect(
      parseProductionResetArgs([
        "--execute",
        "--simulate",
        `--target=${EXECUTE_TARGET_PRODUCTION}`,
        `--confirm=${RESET_CONFIRM_VALUE}`,
        `--plan-fingerprint=${"a".repeat(64)}`,
      ]).mode,
    ).toBe("execute");
  });

  it("requires simulate mode in execute path", () => {
    expect(() => assertSimulateModeRequired(false)).toThrow(/not approved/i);
  });

  it("aborts when recomputed fingerprint differs from approved fingerprint", async () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    await expect(
      assertLiveFingerprintMatches(async () => plan, "b".repeat(64)),
    ).rejects.toThrow(/fingerprint drift/i);
  });

  it("runs simulate execute when fingerprint matches at execute time", async () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    const result = await runProductionResetExecute({
      target: EXECUTE_TARGET_QA_CLONE,
      simulate: true,
      planFingerprint: plan.fingerprint!,
      env: qaCloneEnvFixture(),
      recomputePlan: async () => plan,
      phaseRunner: async () => ({
        simulate: true,
        target: EXECUTE_TARGET_QA_CLONE,
        phases: EXECUTE_PHASE_ORDER.map((phase) => ({ phase, description: phase })),
        dataMutated: false,
        rollbackVerified: true,
      }),
    });
    expect(result.plan.fingerprint).toBe(plan.fingerprint);
    expect(result.execution.dataMutated).toBe(false);
  });

  it("rejects production target inside execute even when args parse", async () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    await expect(
      runProductionResetExecute({
        target: EXECUTE_TARGET_PRODUCTION,
        simulate: true,
        planFingerprint: plan.fingerprint!,
        env: qaCloneEnvFixture(),
        recomputePlan: async () => plan,
      }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("execute phase ordering and simulation rollback", () => {
  it("locks phase order to A→B→B2→C→D→E", () => {
    expect(EXECUTE_PHASE_ORDER).toEqual(["A", "B", "B2", "C", "D", "E"]);
    assertPhaseOrder([...EXECUTE_PHASE_ORDER]);
    expect(() => assertPhaseOrder(["A", "B", "C"])).toThrow(/Phase order mismatch/i);
  });

  it("verifies rollback wrapper leaves captured counts unchanged", async () => {
    let executedSql = "";
    const result = await runSimulatedSqlTransaction(
      "postgresql://qa-clone.example/test",
      ["TRUNCATE TABLE public.bookings RESTART IDENTITY CASCADE"],
      {
        execSql: (_url, sql) => {
          executedSql = sql;
        },
        captureCounts: async () => ({ bookings: 5 }),
        verifyCounts: assertCountsUnchanged,
      },
    );
    expect(result.rolledBack).toBe(true);
    expect(executedSql).toContain("BEGIN");
    expect(executedSql).toContain("ROLLBACK");
  });

  it("throws when rollback verification detects drift", () => {
    expect(() => assertCountsUnchanged({ bookings: 5 }, { bookings: 4 })).toThrow(
      /Rollback verification failed/i,
    );
  });
});

describe("production identity guards", () => {
  it("rejects non-Production SUPABASE_URL", () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = `https://${KNOWN_QA_PROJECT_REF}.supabase.co`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    expect(() => loadProductionEnv()).toThrow(/Refusing/);
    process.env.SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });

  it("does not trust pg_constraint FK graph when CLI is linked to QA", () => {
    const execQuery = vi.fn(() => "payments|bookings|public|CASCADE");
    const result = loadPublicFkEdges({
      linkedRef: KNOWN_QA_PROJECT_REF,
      execQuery,
    });
    expect(result.source).toBe("migrations");
    expect(result.linkedRefVerified).toBe(false);
    expect(execQuery).not.toHaveBeenCalled();
  });

  it("uses pg_constraint when linked ref is Production and query succeeds", () => {
    const migrationEdges = loadFkEdgesFromMigrations();
    const execQuery = vi.fn(() =>
      migrationEdges.map((edge) => `${edge.child}|${edge.parent}|${edge.parentSchema}|${edge.onDelete}`).join("\n"),
    );

    const result = loadPublicFkEdges({
      linkedRef: PRODUCTION_PROJECT_REF,
      execQuery,
    });

    expect(execQuery).toHaveBeenCalledOnce();
    expect(result.source).toBe("pg_constraint");
    expect(result.linkedRefVerified).toBe(true);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("reads linked ref from supabase/.temp/project-ref when present", () => {
    const linkedRef = resolveLinkedSupabaseProjectRef(process.cwd());
    expect(typeof linkedRef === "string" || linkedRef === null).toBe(true);
  });
});

describe("fk closure and migration parsing", () => {
  it("walks FK edges transitively for TRUNCATE CASCADE closure", () => {
    const closure = computeTruncateCascadeClosure(SYNTHETIC_EDGES, ["bookings", "profiles", "user_roles"]);
    expect(closure).toEqual(
      expect.arrayContaining(["bookings", "payments", "messages", "profiles", "providers", "provider_services"]),
    );
    expect(closure).not.toContain("users");
  });

  it("parses FK edges from migration SQL snippets", () => {
    const sql = `
      CREATE TABLE public.bookings (
        profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
        service_id uuid REFERENCES public.services(id)
      );
      ALTER TABLE public.payments
        ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id)
        REFERENCES public.bookings(id) ON DELETE CASCADE;
    `;
    const edges = parseFkEdgesFromSqlFragment(sql);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ child: "bookings", parent: "profiles" }),
        expect.objectContaining({ child: "payments", parent: "bookings", onDelete: "CASCADE" }),
      ]),
    );
  });

  it("validates the real migration FK graph and Phase A closure fail-closed", () => {
    const edges = loadFkEdgesFromMigrations();
    expect(() => assertMigrationFkGraphComplete(edges)).not.toThrow();
    const closure = validateMigrationFkGraphAndClosure(edges);
    expect(closure).toContain("user_roles");
    expect(closure).not.toContain("services");
    expect(closure.length).toBeGreaterThanOrEqual(51);
  });

  it("throws when migration graph is obviously incomplete", () => {
    expect(() => assertMigrationFkGraphComplete([{ child: "payments", parent: "bookings", parentSchema: "public", onDelete: "CASCADE" }])).toThrow(
      /incomplete/i,
    );
  });

  it("throws when a required FK edge is missing", () => {
    const edges = loadFkEdgesFromMigrations().filter(
      (edge) => !(edge.child === "payments" && edge.parent === "bookings"),
    );
    expect(() => assertMigrationFkGraphComplete(edges)).toThrow(/missing required edges.*payments->bookings/i);
  });

  it("throws when a Phase B catalog table leaks into the Phase A closure", () => {
    const closure = validateMigrationFkGraphAndClosure(loadFkEdgesFromMigrations());
    expect(() => assertPhaseAClosureComplete([...closure, "services"])).toThrow(
      /Phase B catalog tables.*services/i,
    );
  });
});

describe("catalog blocking predicates", () => {
  it("blocks when seed service count drifts", () => {
    const services = seedServicesFixture().slice(0, EXPECTED_SEED_SERVICE_COUNT - 1);
    const result = evaluateCatalogBlockingChecks({
      phaseAClosure: ["bookings"],
      seedServices: services,
      deleteServices: qaDeleteServicesFixture(),
      zones: qaZonesFixture(),
    });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toContain("seed-service-count-mismatch");
  });

  it("blocks when a delete-target service lacks QA marker", () => {
    const result = evaluateCatalogBlockingChecks({
      phaseAClosure: ["bookings"],
      seedServices: seedServicesFixture(),
      deleteServices: [{ id: "x", slug: "bad", name_en: "Regular Service" }],
      zones: qaZonesFixture(),
    });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toContain("delete-service-missing-qa-marker");
  });

  it("blocks when any zone lacks QA marker", () => {
    const result = evaluateCatalogBlockingChecks({
      phaseAClosure: ["bookings"],
      seedServices: seedServicesFixture(),
      deleteServices: qaDeleteServicesFixture(),
      zones: [{ id: "z1", name_en: "Downtown Cairo" }],
    });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toContain("zone-missing-qa-marker");
  });

  it("passes fail-closed checks for a valid snapshot", () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    expect(plan.blocked).toBe(false);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns exit code 2 when blocked", () => {
    expect(dryRunExitCode({ blocked: true })).toBe(2);
    expect(dryRunExitCode({ blocked: false })).toBe(0);
  });
});

describe("phase A table row counts", () => {
  it("binds row counts to exactly the programmatic Phase A closure table set", () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    expect(() =>
      assertTableCountsKeysMatchPhaseAClosure(plan.counts.tableCounts, plan.phaseA.truncateCascadeClosure),
    ).not.toThrow();
    expect(new Set(Object.keys(plan.counts.tableCounts))).toEqual(
      new Set(plan.phaseA.truncateCascadeClosure),
    );
    expect(plan.phaseA.truncateCascadeClosure).toContain("zone_services");
  });

  it("throws when tableCounts keys drift from the Phase A closure", () => {
    const closure = phaseAClosureFixture();
    expect(() =>
      assertTableCountsKeysMatchPhaseAClosure({ bookings: 1, extra_table: 2 }, closure),
    ).toThrow(/mismatch/i);
  });
});

describe("fingerprint sensitivity", () => {
  it("changes when one auth-user ID changes", () => {
    const base = buildProductionResetPlanFromSnapshot(validSnapshot());
    const changed = buildProductionResetPlanFromSnapshot(
      validSnapshot({
        authUserIds: ["40000000-0000-4000-8000-000000000002"],
      }),
    );
    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  it("changes when one storage key changes", () => {
    const base = buildProductionResetPlanFromSnapshot(validSnapshot());
    const changed = buildProductionResetPlanFromSnapshot(
      validSnapshot({
        storageObjects: [{ bucket: "avatars", key: "other-user/photo.jpg" }],
      }),
    );
    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  it("changes when one table row count changes", () => {
    const base = buildProductionResetPlanFromSnapshot(validSnapshot());
    const changed = buildProductionResetPlanFromSnapshot(
      validSnapshot({
        tableCounts: phaseATableCountsFixture({ bookings: 999 }),
      }),
    );
    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  it("changes when zone_services row count changes", () => {
    const base = buildProductionResetPlanFromSnapshot(validSnapshot());
    const changed = buildProductionResetPlanFromSnapshot(
      validSnapshot({
        tableCounts: phaseATableCountsFixture({ zone_services: 999 }),
      }),
    );
    expect(changed.fingerprint).not.toBe(base.fingerprint);
  });

  it("changes when one FK edge changes", () => {
    const edges = loadFkEdgesFromMigrations();
    const tableCounts = { audit_logs: 1, bookings: 1 };
    const base = fingerprintPlan({
      version: "production-reset-v1",
      projectRef: PRODUCTION_PROJECT_REF,
      fkGraphSource: "migrations",
      fkEdges: edges,
      phaseATruncateRoots: ["bookings"],
      phaseAClosure: ["bookings"],
      tableCounts,
      serviceDeleteIds: ["a"],
      serviceKeepIds: ["b"],
      serviceRequirementDeleteIds: [],
      zoneDeleteIds: ["z"],
      authUserIds: ["u"],
      storageObjects: [{ bucket: "avatars", key: "u/x" }],
      executeOrder: ["step"],
      blockingInputs: { seedServiceCount: 18 },
    });
    const changed = fingerprintPlan({
      version: "production-reset-v1",
      projectRef: PRODUCTION_PROJECT_REF,
      fkGraphSource: "migrations",
      fkEdges: [...edges, { child: "synthetic", parent: "bookings", parentSchema: "public", onDelete: "CASCADE" }],
      phaseATruncateRoots: ["bookings"],
      phaseAClosure: ["bookings"],
      tableCounts,
      serviceDeleteIds: ["a"],
      serviceKeepIds: ["b"],
      serviceRequirementDeleteIds: [],
      zoneDeleteIds: ["z"],
      authUserIds: ["u"],
      storageObjects: [{ bucket: "avatars", key: "u/x" }],
      executeOrder: ["step"],
      blockingInputs: { seedServiceCount: 18 },
    });
    expect(changed).not.toBe(base);
    expect(fingerprintFkEdges(edges)).not.toBe(
      fingerprintFkEdges([
        ...edges,
        { child: "synthetic", parent: "bookings", parentSchema: "public", onDelete: "CASCADE" },
      ]),
    );
    expect(fingerprintStorageObjectKeys([{ bucket: "avatars", key: "a" }])).not.toBe(
      fingerprintStorageObjectKeys([{ bucket: "avatars", key: "b" }]),
    );
  });
});

describe("report sanitization", () => {
  it("allowlists only permitted report fields", () => {
    const plan = buildProductionResetPlanFromSnapshot(validSnapshot());
    const sanitized = sanitizePlanForReport({
      ...plan,
      secretField: "must-not-appear",
    });
    expect(sanitized).not.toHaveProperty("secretField");
    expect(sanitized).toHaveProperty("fingerprint");
    expect(sanitized).toHaveProperty("blockingInputs");
  });
});
