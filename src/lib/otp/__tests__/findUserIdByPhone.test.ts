import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
  setCookie: () => undefined,
  deleteCookie: () => undefined,
  getRequest: () => ({ headers: new Headers() }),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder: {
      inputValidator: () => typeof builder;
      handler: (handlerFn: unknown) => unknown;
    } = {
      inputValidator: () => builder,
      handler: (handlerFn) => handlerFn,
    };
    return builder;
  },
}));

const rpc = vi.fn();
const listUsers = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      admin: {
        listUsers: (...args: unknown[]) => listUsers(...args),
      },
    },
  },
}));

describe("findUserIdByPhone", () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
    listUsers.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the user id from the auth_user_id_for_phone RPC", async () => {
    rpc.mockResolvedValue({ data: "11111111-1111-1111-1111-111111111111", error: null });
    const { findUserIdByPhone } = await import("@/lib/otp.functions");

    await expect(findUserIdByPhone("+201012345678")).resolves.toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("auth_user_id_for_phone", {
      p_auth_email: "phone-201012345678@famio.local",
      p_phone: "+201012345678",
    });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("returns null when the RPC finds no user", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { findUserIdByPhone } = await import("@/lib/otp.functions");

    await expect(findUserIdByPhone("+201099988877")).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("auth_user_id_for_phone", {
      p_auth_email: "phone-201099988877@famio.local",
      p_phone: "+201099988877",
    });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("finds a user via RPC even when they would sit past the old 1,000-user listUsers window", async () => {
    listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    rpc.mockResolvedValue({ data: "user-beyond-1000", error: null });
    const { findUserIdByPhone } = await import("@/lib/otp.functions");

    await expect(findUserIdByPhone("+201055500001")).resolves.toBe("user-beyond-1000");
    expect(rpc).toHaveBeenCalledWith("auth_user_id_for_phone", {
      p_auth_email: "phone-201055500001@famio.local",
      p_phone: "+201055500001",
    });
    expect(listUsers).not.toHaveBeenCalled();
  });
});
