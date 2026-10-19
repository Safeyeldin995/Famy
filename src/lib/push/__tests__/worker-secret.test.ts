import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerSecret } from "../../../../supabase/functions/send-push-notifications/worker-secret";

const { rpc, createClient, setVapidDetails } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  setVapidDetails: vi.fn(),
}));
vi.mock("npm:@supabase/supabase-js@2", () => ({ createClient }));
vi.mock("npm:web-push@3.6.7", () => ({ default: { setVapidDetails } }));

describe("pure worker secret selection", () => {
  it("prefers a non-empty Vault string over the environment", () => {
    expect(resolveWorkerSecret("synthetic-vault", "synthetic-env") === "synthetic-vault").toBe(
      true,
    );
  });
  it.each([null, undefined, "", 123, {}])("falls back for unusable Vault result %j", (value) => {
    expect(resolveWorkerSecret(value, "synthetic-env") === "synthetic-env").toBe(true);
  });
  it("returns undefined when neither source is configured", () => {
    expect(resolveWorkerSecret(null, undefined)).toBeUndefined();
    expect(resolveWorkerSecret("", "")).toBeUndefined();
  });
});

describe("push worker authorization and cache", () => {
  let handler: (request: Request) => Promise<Response>;
  let env: Record<string, string>;
  let vaultValue: unknown;
  let now: number;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    env = {
      SUPABASE_URL: "https://example.test",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
      NOTIFICATION_WORKER_SECRET: "synthetic-env",
      VAPID_PUBLIC_KEY: "synthetic-public",
      VAPID_PRIVATE_KEY: "synthetic-private",
      VAPID_SUBJECT: "mailto:push@example.test",
    };
    vaultValue = "synthetic-vault";
    rpc.mockImplementation(async (name: string) => ({
      data: name === "get_notification_worker_secret" ? vaultValue : [],
      error: null,
    }));
    createClient.mockReturnValue({ rpc });
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => env[name] },
      serve: (callback: typeof handler) => {
        handler = callback;
      },
    });
    await loadWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function request(presented: string, method = "POST") {
    return new Request("https://example.test/functions/v1/send-push-notifications", {
      method,
      headers: { "x-worker-secret": presented },
    });
  }

  async function loadWorker() {
    // Dynamic path keeps Deno-only runtime types outside the app's TypeScript project.
    const workerPath = "../../../../supabase/functions/send-push-notifications/index.ts";
    await import(workerPath);
  }

  it("uses the service-role client and accepts Vault before the env fallback", async () => {
    const response = await handler(request("synthetic-vault"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(createClient.mock.calls[0]?.[1] === env.SUPABASE_SERVICE_ROLE_KEY).toBe(true);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_notification_worker_secret",
      "claim_notification_outbox_batch",
    ]);
  });

  it.each(["missing", "error", "rejection"])(
    "uses env fallback when Vault lookup is %s",
    async (kind) => {
      if (kind === "missing") vaultValue = null;
      if (kind === "error")
        rpc.mockResolvedValueOnce({ data: "synthetic-unusable", error: { message: "test error" } });
      if (kind === "rejection") rpc.mockRejectedValueOnce(new Error("test transport failure"));
      expect((await handler(request("synthetic-env"))).status).toBe(200);
    },
  );

  it("returns 503 when neither source exists and does not access the outbox", async () => {
    vaultValue = null;
    delete env.NOTIFICATION_WORKER_SECRET;
    const response = await handler(request(""));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "worker_not_configured" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(setVapidDetails).not.toHaveBeenCalled();
    vaultValue = "synthetic-vault";
    expect((await handler(request("synthetic-vault"))).status).toBe(200);
  });

  it.each(["", "synthetic-wrong", "synthetic-env"])(
    "returns 401 on mismatched header",
    async (presented) => {
      const response = await handler(request(presented));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(setVapidDetails).not.toHaveBeenCalled();
    },
  );

  it("refreshes a rotated Vault value at five minutes, without extending the cache on use", async () => {
    expect((await handler(request("synthetic-vault"))).status).toBe(200);
    vaultValue = "synthetic-rotated";
    now = 299_999;
    expect((await handler(request("synthetic-vault"))).status).toBe(200);
    expect(
      rpc.mock.calls.filter(([name]) => name === "get_notification_worker_secret"),
    ).toHaveLength(1);
    now = 300_000;
    expect((await handler(request("synthetic-vault"))).status).toBe(401);
    expect((await handler(request("synthetic-rotated"))).status).toBe(200);
    expect(
      rpc.mock.calls.filter(([name]) => name === "get_notification_worker_secret"),
    ).toHaveLength(2);
  });

  it("expires an env fallback so a newly available Vault value takes priority", async () => {
    vaultValue = null;
    expect((await handler(request("synthetic-env"))).status).toBe(200);
    vaultValue = "synthetic-vault";
    now = 300_000;
    expect((await handler(request("synthetic-vault"))).status).toBe(200);
  });

  it("keeps the method check before the Vault lookup", async () => {
    expect((await handler(request("", "GET"))).status).toBe(405);
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the VAPID configuration check after authorization", async () => {
    delete env.VAPID_PRIVATE_KEY;
    vi.resetModules();
    await loadWorker();
    const response = await handler(request("synthetic-vault"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "vapid_not_configured" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
