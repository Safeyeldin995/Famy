import { describe, expect, it, vi, beforeEach } from "vitest";

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const runTeardownForUserIds = vi.fn();
const getSupabaseAdmin = vi.fn(() => ({}));

vi.mock("../registry.mjs", () => ({
  readRegistry,
  writeRegistry,
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
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: ["good-user-001"],
      refused: [{ userId: "bad-user-0002", reason: "insufficient-qa-signals" }],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(readRegistry).toHaveBeenCalled();
    expect(runTeardownForUserIds).toHaveBeenCalledWith(
      {},
      ["good-user-001", "bad-user-0002"],
      { execute: true, registryIds: ["good-user-001", "bad-user-0002"] },
    );
    expect(writeRegistry).toHaveBeenCalledWith({
      users: [{ userId: "bad-user-0002", key: "adminSeed" }],
      qaPassword: "secret",
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
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: [],
      refused: [
        { userId: "bad-1", reason: "insufficient-qa-signals" },
        { userId: "bad-2", reason: "insufficient-qa-signals" },
      ],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(writeRegistry).toHaveBeenCalledWith({
      users: [
        { userId: "bad-1", key: "a" },
        { userId: "bad-2", key: "b" },
      ],
    });
    expect(result.remaining).toBe(2);
    expect(result.recovered).toBe(0);
  });

  it("clears registry when all cleanups succeed", async () => {
    readRegistry.mockReturnValue({
      users: [{ userId: "good-1", key: "customer" }],
    });
    runTeardownForUserIds.mockResolvedValue({
      succeeded: ["good-1"],
      refused: [],
    });

    const { recoverRegistryOrphans } = await import("../orphan-recovery.mjs");
    const result = await recoverRegistryOrphans();

    expect(writeRegistry).toHaveBeenCalledWith({ users: [] });
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
