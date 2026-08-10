import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertQaE2eBaselineReadOnly,
  EXPECTED_ACTIVE_CATEGORY_COUNT,
  EXPECTED_SEEDED_NON_QA_SERVICE_COUNT,
  EXPECTED_STORAGE_BUCKET_COUNT,
  readSettingsBaselinePresence,
} from "../e2e-baseline.mjs";
import { teardownSnapshotZone } from "../e2e-resource-teardown.mjs";
import {
  compactRegistry,
  configureRegistryRootForTests,
  createEmptyE2eResources,
  publishE2eFixtureSnapshot,
  readE2eSnapshotResources,
  readRegistry,
  registerE2eRunResource,
  resetRegistryRootForTests,
  writeRegistry,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

function buildCompleteFixtureReg(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    qaPassword: "qa-synthetic-password",
    phones: { customer: "100000000001", provider: "100000000002", adminSeed: "100000000003" },
    e2eSnapshot: {
      runId: "run-1",
      publishedAt: null,
      requiredKeys: ["customer", "provider", "adminSeed"],
      userIds: [],
      resources: createEmptyE2eResources(),
    },
    users: [
      { key: "customer", userId: "cust-001", phone: "+20100000000001" },
      { key: "provider", userId: "prov-002", phone: "+20100000000002" },
      { key: "adminSeed", userId: "admin-003", phone: "+20100000000003" },
    ],
    ...overrides,
  };
}

describe("E2E baseline assertion", () => {
  it("fails clearly when required settings rows are missing", async () => {
    const admin = {
      from: (table) => ({
        select: () => ({
          eq: (_col, key) => ({
            maybeSingle: async () => ({
              data: table === "settings" && key === "billing" ? null : { key },
              error: null,
            }),
          }),
        }),
      }),
      storage: { listBuckets: async () => ({ data: [{ id: "avatars" }], error: null }) },
    };
    await expect(assertQaE2eBaselineReadOnly(admin)).rejects.toThrow(/missing required settings rows: billing/);
  });

  it("performs no writes when baseline passes", async () => {
    const writes = [];
    const admin = {
      from: (table) => ({
        select: (_cols, opts) => {
          if (opts?.count === "exact") {
            if (table === "services") {
              return {
                not: () => ({
                  eq: async () => ({ count: EXPECTED_SEEDED_NON_QA_SERVICE_COUNT, error: null }),
                }),
              };
            }
            return {
              eq: async () => ({
                count: table === "categories" ? EXPECTED_ACTIVE_CATEGORY_COUNT : 1,
                error: null,
              }),
            };
          }
          if (table === "categories") {
            return { eq: async () => ({ count: EXPECTED_ACTIVE_CATEGORY_COUNT, error: null }) };
          }
          if (table === "services") {
            return {
              not: () => ({
                eq: async () => ({ count: EXPECTED_SEEDED_NON_QA_SERVICE_COUNT, error: null }),
              }),
            };
          }
          return {
            eq: (_col, key) => ({
              maybeSingle: async () => ({ data: { key }, error: null }),
            }),
          };
        },
        upsert: (...args) => { writes.push(["upsert", table, args]); },
        insert: (...args) => { writes.push(["insert", table, args]); },
        update: (...args) => { writes.push(["update", table, args]); },
        delete: (...args) => { writes.push(["delete", table, args]); },
      }),
      storage: {
        listBuckets: async () => ({
          data: [
            { id: "avatars" },
            { id: "provider-documents" },
            { id: "payment-proofs" },
            { id: "case-evidence" },
          ],
          error: null,
        }),
      },
    };
    const result = await assertQaE2eBaselineReadOnly(admin);
    expect(result.ok).toBe(true);
    expect(result.storageBucketCount).toBe(EXPECTED_STORAGE_BUCKET_COUNT);
    expect(writes).toEqual([]);
  });

  it("readSettingsBaselinePresence is read-only", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    await expect(readSettingsBaselinePresence(admin, "billing")).resolves.toBe(false);
  });
});

describe("E2E resource snapshot contract", () => {
  const harness = useIsolatedRegistry();

  it("publishes current-run resource IDs in snapshot", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerE2eRunResource("zoneIds", "zone-001");
    registerE2eRunResource("serviceIds", "svc-002");
    const resources = readE2eSnapshotResources();
    expect(resources.zoneIds).toEqual(["zone-001"]);
    expect(resources.serviceIds).toEqual(["svc-002"]);
  });

  it("resource IDs survive journal merge and compaction", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerE2eRunResource("zoneIds", "zone-001");
    registerE2eRunResource("providerIds", "prov-003");
    compactRegistry();
    const resources = readE2eSnapshotResources();
    expect(resources.zoneIds).toEqual(["zone-001"]);
    expect(resources.providerIds).toEqual(["prov-003"]);
  });

  it("a separate process can read identical resource snapshot", () => {
    const root = harness.getDir();
    configureRegistryRootForTests(root);
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerE2eRunResource("zoneIds", "zone-shared");

    const registryModule = path.resolve(process.cwd(), "qa/registry.mjs");
    const scriptPath = path.join(root, "child-read-resources.mjs");
    fs.writeFileSync(scriptPath, `
      import { pathToFileURL } from "node:url";
      const registryModule = ${JSON.stringify(registryModule)};
      const { configureRegistryRootForTests, readE2eSnapshotResources } = await import(pathToFileURL(registryModule).href);
      configureRegistryRootForTests(${JSON.stringify(root)});
      const resources = readE2eSnapshotResources();
      if (resources.zoneIds.join(",") !== "zone-shared") process.exit(2);
    `);
    execFileSync(process.execPath, [scriptPath], { stdio: "pipe", cwd: process.cwd() });
  });

  it("deduplicates duplicate resource IDs", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerE2eRunResource("zoneIds", "zone-dup");
    registerE2eRunResource("zoneIds", "zone-dup");
    expect(readE2eSnapshotResources().zoneIds).toEqual(["zone-dup"]);
  });

  it("excludes stale run resources from another runId", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg({ e2eSnapshot: { runId: "run-1", publishedAt: null, requiredKeys: [], userIds: [], resources: createEmptyE2eResources() } }));
    registerE2eRunResource("zoneIds", "zone-current");
    expect(readE2eSnapshotResources().zoneIds).toEqual(["zone-current"]);
    writeRegistry({
      ...readRegistry(),
      e2eSnapshot: {
        ...readRegistry().e2eSnapshot,
        runId: "run-2",
        resources: createEmptyE2eResources(),
      },
    });
    expect(readE2eSnapshotResources().zoneIds).toEqual([]);
  });

  it("rejects resource registration before snapshot publish", () => {
    writeRegistry({ users: [], qaPassword: "test-password" });
    expect(() => registerE2eRunResource("zoneIds", "zone-001")).toThrow(/before fixture snapshot is published/);
  });

  it("zone cleanup is attempted for snapshot-owned zones", async () => {
    const calls = [];
    const admin = {
      from: (table) => ({
        delete: () => ({
          eq: async (_col, value) => {
            calls.push(["delete", table, value]);
            return { error: table === "zones" ? { message: "fk blocked" } : null };
          },
        }),
        update: () => ({
          eq: async (_col, value) => {
            calls.push(["update", table, value]);
            return { error: null };
          },
        }),
      }),
    };
    const result = await teardownSnapshotZone(admin, "zone-001");
    expect(result.action).toBe("deactivated");
    expect(calls.some((row) => row[0] === "update" && row[1] === "zones")).toBe(true);
  });
});

describe("isolated registry root guard", () => {
  it("fails clearly when fixture snapshot is not published in isolated root", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-registry-missing-"));
    try {
      configureRegistryRootForTests(tmpDir);
      expect(() => registerE2eRunResource("zoneIds", "zone-001")).toThrow(/before fixture snapshot is published/);
    } finally {
      resetRegistryRootForTests();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
