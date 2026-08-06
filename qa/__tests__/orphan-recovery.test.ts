import { describe, expect, it, vi, beforeEach } from "vitest";

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const removeRegistryUsers = vi.fn();
const readE2eFixtureUserIds = vi.fn(() => {
  const reg = readRegistry();
  if (Array.isArray(reg.e2eSnapshot?.userIds) && reg.e2eSnapshot.userIds.length) {
    return [...reg.e2eSnapshot.userIds];
  }
  return (reg.users ?? []).map((u: { userId?: string }) => u.userId).filter(Boolean);
});
const runTeardownForUserIds = vi.fn();
const getSupabaseAdmin = vi.fn(() => ({}));

vi.mock("../registry.mjs", () => ({
  readRegistry,
  writeRegistry,
  removeRegistryUsers,
  readE2eFixtureUserIds,
}));

vi.mock("../teardown-core.mjs", () => ({
  runTeardownForUserIds,
}));

vi.mock("../admin-client.mjs", () => ({
  getSupabaseAdmin,
}));

describe("recoverRegistryOrphans", () => {
  beforeEach(() => {
    readRegistry.mockReset();
    writeRegistry.mockReset();
    removeRegistryUsers.mockReset();
    readE2eFixtureUserIds.mockClear();
    runTeardownForUserIds.mockReset();
    getSupabaseAdmin.mockReset();
    getSupabaseAdmin.mockReturnValue({});
  });

  it("reads registry before mutation and retains only failed ids", async () => {
    readRegistry.mockReturnValue({
      users: [
        { userId: "good-user-001", key: "customer" },
        { userId: "bad-user-0002", key: "adminSeed" },
      ],
      qaPassword: "secret",
      e2eSnapshot: { userIds: ["good-user-001", "bad-user-0002"] },
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: ["good-user-001"],
      refused: [{ userId: "bad-user-0002", reason: "insufficient-qa-signals" }],
      failed: [],
      retained: [],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(readRegistry).toHaveBeenCalled();
    expect(runTeardownForUserIds).toHaveBeenCalledWith(
      {},
      ["good-user-001", "bad-user-0002"],
      { execute: true, registryIds: ["good-user-001", "bad-user-0002"] },
    );
    expect(removeRegistryUsers).toHaveBeenCalledWith(["good-user-001"]);
    expect(writeRegistry).toHaveBeenCalledWith({
      users: [{ userId: "bad-user-0002", key: "adminSeed" }],
      qaPassword: "secret",
      e2eSnapshot: null,
    });
    expect(result.recovered).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.remainingUserIds).toEqual(["bad-user-0002"]);
  });

  it("retains all ids when every cleanup fails", async () => {
    readRegistry.mockReturnValue({
      users: [
        { userId: "bad-1", key: "a" },
        { userId: "bad-2", key: "b" },
      ],
      e2eSnapshot: { userIds: ["bad-1", "bad-2"] },
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: [],
      refused: [
        { userId: "bad-1", reason: "insufficient-qa-signals" },
        { userId: "bad-2", reason: "insufficient-qa-signals" },
      ],
      failed: [],
      retained: [],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(writeRegistry).toHaveBeenCalledWith({
      users: [
        { userId: "bad-1", key: "a" },
        { userId: "bad-2", key: "b" },
      ],
      e2eSnapshot: null,
    });
    expect(result.remaining).toBe(2);
    expect(result.recovered).toBe(0);
  });

  it("clears registry when all cleanups succeed", async () => {
    readRegistry.mockReturnValue({
      users: [{ userId: "good-1", key: "customer" }],
      e2eSnapshot: { userIds: ["good-1"] },
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: ["good-1"],
      refused: [],
      failed: [],
      retained: [],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(removeRegistryUsers).toHaveBeenCalledWith(["good-1"]);
    expect(writeRegistry).toHaveBeenCalledWith({
      users: [],
      e2eSnapshot: null,
    });
    expect(result.recovered).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("is idempotent when registry is already empty", async () => {
    readRegistry.mockReturnValue({ users: [] });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(runTeardownForUserIds).not.toHaveBeenCalled();
    expect(writeRegistry).not.toHaveBeenCalled();
    expect(result).toEqual({ recovered: 0, remaining: 0, remainingUserIds: [] });
  });

  it("does not invoke teardown when registry has no user ids", async () => {
    readRegistry.mockReturnValue({ users: [{ key: "orphan-without-id" }] });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(runTeardownForUserIds).not.toHaveBeenCalled();
    expect(result.remaining).toBe(0);
  });
});
