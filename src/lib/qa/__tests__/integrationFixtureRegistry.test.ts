import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { IntegrationFixtureRegistry, runRegisteredTeardown } from "@/lib/qa/integrationFixtureRegistry";
import { teardownRegisteredFixture } from "@/lib/qa/integrationFixtureTeardown";
// @ts-expect-error — .mjs module has no generated declarations
import { containIntegrationFixtureResidue } from "../../../../qa/containment-integration.mjs";
import {
  discoverIntegrationGuardTargets,
  scanFileForForbiddenCliPatterns,
} from "@/lib/qa/integrationGuardDiscovery";

vi.mock("../../../../qa/containment-integration.mjs", () => ({
  containIntegrationFixtureResidue: vi.fn(async () => ({
    plan: {
      version: "6a.2-containment-v1",
      fingerprint: "test",
      counts: { planned_actions: 1, excluded_identities: 0 },
      actions: [],
      excluded: [],
    },
    execution: {
      results: [{ ok: true, maskedId: "qa-u…ser", entityType: "identity" }],
    },
  })),
}));

vi.mock("../../../../qa/registry.mjs", () => ({
  readRegistry: vi.fn(() => ({ users: [] })),
  recordRecoveryFailure: vi.fn(),
  removeRegistryUsers: vi.fn(),
  registerUserEntry: vi.fn(),
}));

describe("integration fixture registry", () => {
  it("registers fixture ids before mutation", () => {
    const registry = new IntegrationFixtureRegistry({ suite: "test" });
    registry.registerUser("user-1", { email: "qa-test@famio.local" });
    registry.registerRole("user-1", "admin");
    registry.registerService("svc-1");
    expect(registry.snapshot().adminUserIds).toEqual(["user-1"]);
  });

  it("retains failed cleanup ids in recovery state", () => {
    const registry = new IntegrationFixtureRegistry();
    registry.markCleanupFailed("user-9", "auth-user", "delete failed");
    expect(registry.getFailedCleanupIds()).toHaveLength(1);
  });

  it("always marks teardown after runRegisteredTeardown even when teardown throws", async () => {
    const registry = new IntegrationFixtureRegistry();
    await expect(runRegisteredTeardown(registry, async () => {
      throw new Error("teardown failed");
    })).rejects.toThrow("teardown failed");
    expect(registry.wasTornDown()).toBe(true);
  });

  it("tracks run-owned admin ids", () => {
    const registry = new IntegrationFixtureRegistry();
    registry.registerUser("admin-1", { email: "qa-admin@famio.local", admin: true });
    expect(registry.getRunOwnedAdminUserIds()).toEqual(["admin-1"]);
  });
});

describe("integration CLI guard discovery", () => {
  it("discovers every otp-integration config glob target", () => {
    const targets = discoverIntegrationGuardTargets();
    expect(targets.some((f) => f.includes("otp/") && f.endsWith(".integration.test.ts"))).toBe(true);
    expect(targets.some((f) => f.includes("auth/"))).toBe(true);
    expect(targets.some((f) => f.includes("provider/"))).toBe(true);
    expect(targets.some((f) => f.includes("booking/"))).toBe(true);
    expect(targets.some((f) => f.includes("db/"))).toBe(true);
    expect(targets).toContain("src/lib/booking/__tests__/booking.harness.ts");
    expect(targets).toContain("src/lib/provider/__tests__/providerOnboarding.harness.ts");
  });

  it("flags CLI policy probes and ignores safe harness code", () => {
    const safe = `
      import { createClient } from "@supabase/supabase-js";
      export async function rpcCreateBooking() {}
    `;
    expect(scanFileForForbiddenCliPatterns(safe)).toEqual([]);
    const unsafe = `execSync("npx supabase db query --linked \\"SELECT * FROM pg_policies\\"")`;
    expect(scanFileForForbiddenCliPatterns(unsafe).length).toBeGreaterThan(0);
  });

  it("scans all discovered integration targets on disk", () => {
    for (const relativePath of discoverIntegrationGuardTargets()) {
      const source = fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
      const hits = scanFileForForbiddenCliPatterns(source);
      expect(hits, `${relativePath} must not contain ${hits.join(", ")}`).toEqual([]);
    }
  });
});

describe("seed category invariant", () => {
  it("throws when expected seeded category is absent", async () => {
    const { requireSeededCategory } = await import("@/lib/qa/seedCategory");
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    };
    await expect(requireSeededCategory(admin as never, "home-cleaning")).rejects.toThrow(
      /Expected seeded category/,
    );
  });
});

describe("setup failure cleanup contract", () => {
  it("teardownRegisteredFixture invokes snapshot-scoped containment for registered users", async () => {
    const mocked = vi.mocked(containIntegrationFixtureResidue);
    mocked.mockClear();

    const registry = new IntegrationFixtureRegistry();
    registry.registerUser("qa-user", { email: "qa-user@famio.local" });
    const admin = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
          in: vi.fn(async () => ({ error: null })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
      auth: { admin: { getUserById: vi.fn() } },
    };

    await teardownRegisteredFixture(admin as never, registry);
    expect(mocked).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ userIds: ["qa-user"] }),
      expect.any(Object),
    );
  });
});
