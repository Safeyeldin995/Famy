import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createEmptyE2eResources,
  publishE2eFixtureSnapshot,
  readE2eSnapshotResources,
  registerE2eRunResource,
} from "../registry.mjs";
import { runE2eSnapshotResourceTeardown } from "../e2e-resource-teardown.mjs";
import { useIsolatedRegistry } from "./registry-test-harness.ts";

const REPO_ROOT = process.cwd();
const SPEC_PATH = path.join(REPO_ROOT, "qa/tests/provider-eligibility.spec.ts");

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

describe("provider eligibility zone registration", () => {
  useIsolatedRegistry();

  it("registers the created zone immediately after insert in the spec source", () => {
    const source = fs.readFileSync(SPEC_PATH, "utf8");
    const insertIndex = source.indexOf('from("zones").insert({');
    const registerIndex = source.indexOf('registerE2eRunResource("zoneIds", zone!.id);');
    expect(insertIndex).toBeGreaterThan(-1);
    expect(registerIndex).toBeGreaterThan(insertIndex);
    const between = source.slice(insertIndex, registerIndex);
    expect(between).not.toMatch(/await customerContext|await providerContext|try \{/);
  });

  it("survives snapshot publication and reaches teardown scope", async () => {
    publishE2eFixtureSnapshot(buildCompleteFixtureReg());
    registerE2eRunResource("zoneIds", "11111111-1111-4111-8111-111111111111");
    registerE2eRunResource("zoneIds", "22222222-2222-4222-8222-222222222222");

    const resources = readE2eSnapshotResources();
    expect(resources.zoneIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(resources.zoneIds).not.toContain("historical-zone-999");

    const admin = {
      from: (table: string) => ({
        delete: () => ({
          eq: async () => ({ error: null }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
    };

    const outcomes = await runE2eSnapshotResourceTeardown(admin as never, resources);
    expect(outcomes.outcomes.filter((row) => row.table === "zones")).toHaveLength(2);
    expect(outcomes.outcomes.some((row) => row.id === "historical-zone-999")).toBe(false);
  });

  it("registry regression harness uses isolated registry imports only", () => {
    const harnessSource = fs.readFileSync(path.join(REPO_ROOT, "qa/__tests__/provider-eligibility-registry.test.ts"), "utf8");
    const importBlock = harnessSource.split("describe(")[0] ?? "";
    expect(importBlock).not.toMatch(/authenticated-client/);
    expect(importBlock).not.toMatch(/admin-client/);
    expect(importBlock).toMatch(/registry\.mjs/);
  });
});
