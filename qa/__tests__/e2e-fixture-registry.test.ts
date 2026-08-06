import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertE2eFixtureSnapshotComplete,
  compactRegistry,
  configureRegistryRootForTests,
  mergeRegistryState,
  publishE2eFixtureSnapshot,
  readE2eFixtureUser,
  readE2eFixtureUserIds,
  readRegistry,
  registerUserEntry,
  resetRegistryRootForTests,
  writeRegistry,
  writeRegistryAtomic,
} from "../registry.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";
import { useIsolatedQaEnv } from "./qa-env-test-harness.ts";
import { runPlaywrightGlobalTeardown } from "../teardown-core.mjs";

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
    },
    users: [
      { key: "customer", userId: "cust-001", phone: "+20100000000001" },
      { key: "provider", userId: "prov-002", phone: "+20100000000002" },
      { key: "adminSeed", userId: "admin-003", phone: "+20100000000003" },
    ],
    ...overrides,
  };
}

describe("E2E fixture registry contract", () => {
  const harness = useIsolatedRegistry();

  it("global setup writes complete fixture snapshot", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    const reg = readRegistry();
    expect(reg.e2eSnapshot?.requiredKeys).toEqual(["customer", "provider", "adminSeed"]);
    expect(reg.users.map((u) => u.key).sort()).toEqual(["adminSeed", "customer", "provider"]);
    expect(readE2eFixtureUserIds().sort()).toEqual(["admin-003", "cust-001", "prov-002"]);
  });

  it("a separate Node process can read the same snapshot", () => {
    const root = harness.getDir();
    configureRegistryRootForTests(root);
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());

    const registryModule = path.resolve(process.cwd(), "qa/registry.mjs");
    const scriptPath = path.join(root, "child-read.mjs");
    fs.writeFileSync(scriptPath, `
      import { pathToFileURL } from "node:url";
      const registryModule = ${JSON.stringify(registryModule)};
      const { configureRegistryRootForTests, readRegistry, readE2eFixtureUser } = await import(pathToFileURL(registryModule).href);
      configureRegistryRootForTests(${JSON.stringify(root)});
      const reg = readRegistry();
      const customer = readE2eFixtureUser("customer");
      if (!reg.e2eSnapshot?.userIds?.length) process.exit(2);
      if (customer.userId !== "cust-001") process.exit(3);
    `);
    execFileSync(process.execPath, [scriptPath], { stdio: "pipe", cwd: process.cwd() });
  });

  it("customer/provider/adminSeed survive registry normalization", () => {
    registerUserEntry({ userId: "cust-001", key: "customer", phone: "+20100000000001" });
    registerUserEntry({ userId: "prov-002", key: "provider", phone: "+20100000000002" });
    registerUserEntry({ userId: "admin-003", key: "adminSeed", phone: "+20100000000003" });
    writeRegistry({
      qaPassword: "qa-synthetic-password",
      phones: { customer: "100000000001" },
      users: [{ key: "customer", userId: "cust-001", phone: "+20100000000001" }],
    });
    const merged = mergeRegistryState();
    expect(merged.users.find((u) => u.key === "provider")?.userId).toBe("prov-002");
    expect(merged.users.find((u) => u.key === "adminSeed")?.userId).toBe("admin-003");
  });

  it("customer/provider/adminSeed survive journal compaction", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerUserEntry({ userId: "extra-004", key: "eligibleProvider", phone: "+20100000000004" });
    compactRegistry();
    const reg = readRegistry();
    expect(reg.users.find((u) => u.key === "customer")?.userId).toBe("cust-001");
    expect(reg.users.find((u) => u.key === "provider")?.userId).toBe("prov-002");
    expect(reg.users.find((u) => u.key === "adminSeed")?.userId).toBe("admin-003");
    expect(reg.qaPassword).toBe("qa-synthetic-password");
    expect(reg.e2eSnapshot?.userIds.length).toBe(3);
  });

  it("users[] and fixture metadata coexist without loss", () => {
    const published = publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    expect(published.phones?.customer).toBe("100000000001");
    expect(published.users).toHaveLength(3);
    expect(typeof published.qaPassword).toBe("string");
  });

  it("atomic write produces valid complete snapshot on disk", () => {
    const root = harness.getDir();
    configureRegistryRootForTests(root);
    writeRegistryAtomic(buildCompleteFixtureReg());
    const registryFile = path.join(root, "registry.json");
    const parsed = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    assertE2eFixtureSnapshotComplete(parsed);
    expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("wrong registry root fails clearly", () => {
    resetRegistryRootForTests();
    expect(() => readE2eFixtureUser("customer")).toThrow(/Run Playwright global setup first/);
  });

  it("stale previous-run snapshot is not selected after publish", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg({
      users: [
        { key: "customer", userId: "old-cust", phone: "+20100000000001" },
        { key: "provider", userId: "old-prov", phone: "+20100000000002" },
        { key: "adminSeed", userId: "old-admin", phone: "+20100000000003" },
      ],
    }));
    publishE2eFixtureSnapshot(buildCompleteFixtureReg({
      e2eSnapshot: {
        runId: "run-2",
        publishedAt: null,
        requiredKeys: ["customer", "provider", "adminSeed"],
        userIds: [],
      },
      users: [
        { key: "customer", userId: "new-cust", phone: "+20100000000001" },
        { key: "provider", userId: "new-prov", phone: "+20100000000002" },
        { key: "adminSeed", userId: "new-admin", phone: "+20100000000003" },
      ],
    }));
    expect(readE2eFixtureUserIds().sort()).toEqual(["new-admin", "new-cust", "new-prov"]);
    expect(readRegistry().e2eSnapshot?.runId).toBe("run-2");
  });

  it("missing snapshot does not pass completeness validation", () => {
    expect(() => assertE2eFixtureSnapshotComplete({ users: [], qaPassword: "x" }))
      .toThrow(/missing fixture key customer/);
  });

  it("password values are preserved in registry but not duplicated into e2eSnapshot metadata", () => {
    const published = publishE2eFixtureSnapshot(buildCompleteFixtureReg({ qaPassword: "super-secret-password" }));
    expect(published.qaPassword).toBe("super-secret-password");
    expect(JSON.stringify(published.e2eSnapshot)).not.toContain("super-secret-password");
  });
});

describe("playwright global teardown snapshot scope", () => {
  useIsolatedQaEnv();

  /** @type {string} */
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-e2e-teardown-scope-"));
    configureRegistryRootForTests(tmpDir);
  });

  afterEach(() => {
    resetRegistryRootForTests();
  });

  it("missing snapshot does not trigger global cleanup", async () => {
    writeRegistry({ users: [{ userId: "historical-1", key: "legacy" }], qaPassword: "test-password" });
    const result = await runPlaywrightGlobalTeardown();
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no_e2e_fixture_snapshot");
  });

  it("global teardown uses only published snapshot user ids", () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg({
      users: [
        { key: "customer", userId: "snap-cust", phone: "+20100000000001" },
        { key: "provider", userId: "snap-prov", phone: "+20100000000002" },
        { key: "adminSeed", userId: "snap-admin", phone: "+20100000000003" },
      ],
    }));
    writeRegistry({
      ...readRegistry(),
      users: [
        ...readRegistry().users,
        { userId: "historical-999", key: "legacy" },
      ],
    });
    expect(readE2eFixtureUserIds().sort()).toEqual(["snap-admin", "snap-cust", "snap-prov"]);
    expect(readRegistry().users).toHaveLength(4);
  });
});
