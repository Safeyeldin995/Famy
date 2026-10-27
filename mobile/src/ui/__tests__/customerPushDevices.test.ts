import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  userId: "fixture-owner" as string | null,
  calls: [] as unknown[][],
  replies: {} as Record<string, unknown>,
  rpcError: null as unknown,
  invalidations: [] as unknown[],
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ session: state.userId ? { user: { id: state.userId } } : null }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({
    invalidateQueries: (key: unknown) => {
      state.invalidations.push(key);
    },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: (columns: string) => {
          state.calls.push([table, "select", columns]);
          return chain;
        },
        eq: (key: string, value: string) => {
          state.calls.push([table, "eq", key, value]);
          return chain;
        },
        is: (key: string, value: null) => {
          state.calls.push([table, "is", key, value]);
          return chain;
        },
        single: () => Promise.resolve(state.replies[table]),
        then: (resolve: (reply: unknown) => unknown) =>
          Promise.resolve(state.replies[table]).then(resolve),
      };
      return chain;
    },
    rpc: async (name: string, args: unknown) => {
      state.calls.push(["rpc", name, args]);
      return { error: state.rpcError };
    },
  },
}));
import {
  useCustomerPushDevices as getMockedDeviceQuery,
  useRevokeCustomerPushDevice as getMockedDeviceMutation,
  type CustomerPushDevice,
} from "@/lib/customerPushDevices";
const device: CustomerPushDevice = {
  id: "device-1",
  kind: "native",
  device_label: "Android",
  last_seen_at: "2026-01-01",
};
const load = () =>
  (getMockedDeviceQuery() as unknown as { queryFn: () => Promise<CustomerPushDevice[]> }).queryFn();
const revoke = () =>
  getMockedDeviceMutation() as unknown as {
    mutationFn: (d: CustomerPushDevice) => Promise<void>;
    onSuccess: () => void;
  };
describe("customer device registration metadata and revocation", () => {
  beforeEach(() => {
    state.userId = "fixture-owner";
    state.calls = [];
    state.invalidations = [];
    state.rpcError = null;
    state.replies = {
      push_subscriptions: {
        data: [{ id: "web-1", device_label: "Browser", last_seen_at: "2026-01-01" }],
        error: null,
      },
      device_push_tokens: {
        data: [{ id: "device-1", platform: "android", last_seen_at: "2026-01-02" }],
        error: null,
      },
    };
  });
  it("reads only active owner metadata, never tokens or endpoints", async () => {
    expect((await load()).map((d) => d.kind)).toEqual(["native", "web"]);
    for (const table of ["push_subscriptions", "device_push_tokens"]) {
      expect(state.calls).toContainEqual([table, "eq", "user_id", "fixture-owner"]);
      expect(state.calls).toContainEqual([table, "is", "revoked_at", null]);
    }
    expect(
      state.calls
        .filter((c) => c[1] === "select")
        .map((c) => c[2])
        .join(","),
    ).not.toMatch(/token|endpoint/);
  });
  it("fails closed for signed-out users and read errors", async () => {
    state.userId = null;
    await expect(load()).rejects.toThrow("not_authenticated");
    await expect(revoke().mutationFn(device)).rejects.toThrow("not_authenticated");
    expect(state.calls).toEqual([]);
    state.userId = "fixture-owner";
    state.replies.device_push_tokens = { data: null, error: new Error("read failed") };
    await expect(load()).rejects.toThrow("read failed");
  });
  it("resolves a native token under ownership before calling the existing guarded RPC", async () => {
    state.replies.device_push_tokens = { data: { token: "synthetic-token" }, error: null };
    await revoke().mutationFn(device);
    expect(state.calls).toContainEqual(["device_push_tokens", "eq", "id", device.id]);
    expect(state.calls).toContainEqual(["device_push_tokens", "eq", "user_id", "fixture-owner"]);
    expect(state.calls).toContainEqual([
      "rpc",
      "revoke_device_push_token",
      { p_token: "synthetic-token" },
    ]);
  });
  it("does not claim revocation or invalidate on failed ownership/RPC checks", async () => {
    state.replies.device_push_tokens = { data: null, error: new Error("not found") };
    await expect(revoke().mutationFn(device)).rejects.toThrow("not found");
    expect(state.calls.some((c) => c[0] === "rpc")).toBe(false);
    state.rpcError = new Error("denied");
    await expect(revoke().mutationFn({ ...device, kind: "web" })).rejects.toThrow("denied");
    expect(state.invalidations).toEqual([]);
  });
  it("uses the existing web-ID RPC and refreshes the list on confirmed success", async () => {
    const mutation = revoke();
    await mutation.mutationFn({ ...device, kind: "web" });
    mutation.onSuccess();
    expect(state.calls).toContainEqual([
      "rpc",
      "revoke_push_subscription_by_id",
      { p_id: device.id },
    ]);
    expect(state.invalidations).toEqual([{ queryKey: ["customer-push-devices"] }]);
  });
});
