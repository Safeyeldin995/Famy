import { describe, expect, it, vi } from "vitest";
import {
  finalizeDeletedAuthUser,
  parseAnonymizeStoragePaths,
  removeAnonymizedStorageObjects,
  runAccountDeletion,
} from "../accountDeletion.server";

describe("parseAnonymizeStoragePaths", () => {
  it("keeps only valid bucket/path pairs", () => {
    expect(
      parseAnonymizeStoragePaths({
        storage_paths: [
          { bucket: "avatars", path: "a.jpg" },
          { bucket: "", path: "x" },
          { bucket: "provider-documents", path: "doc.pdf" },
        ],
      }),
    ).toEqual([
      { bucket: "avatars", path: "a.jpg" },
      { bucket: "provider-documents", path: "doc.pdf" },
    ]);
  });
});

function adminRoleClient(isAdmin: boolean) {
  const chain = {
    eq: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: isAdmin ? [{ role: "admin" }] : [], error: null })),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => chain),
    })),
  };
}

describe("runAccountDeletion", () => {
  it("blocks admin users via user_roles before RPC", async () => {
    const supabaseUser = { rpc: vi.fn() };
    const supabaseAdmin = {
      ...adminRoleClient(true),
      rpc: vi.fn(),
      storage: { from: vi.fn() },
      auth: { admin: { updateUserById: vi.fn() } },
    };

    const result = await runAccountDeletion({
      supabaseUser: supabaseUser as never,
      supabaseAdmin: supabaseAdmin as never,
      userId: "admin-user",
    });

    expect(result).toEqual({ ok: false, error: "admin_not_allowed", status: 403 });
    expect(supabaseUser.rpc).not.toHaveBeenCalled();
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("returns active_bookings when the eligibility RPC blocks", async () => {
    const supabaseUser = {
      rpc: vi.fn(async (name: string) => {
        expect(name).toBe("account_deletion_check");
        return { data: { ok: false, reason: "active_bookings" }, error: null };
      }),
    };
    const supabaseAdmin = {
      ...adminRoleClient(false),
      rpc: vi.fn(),
      storage: { from: vi.fn() },
      auth: { admin: { updateUserById: vi.fn() } },
    };

    const result = await runAccountDeletion({
      supabaseUser: supabaseUser as never,
      supabaseAdmin: supabaseAdmin as never,
      userId: "user-1",
    });

    expect(result).toEqual({ ok: false, error: "active_bookings", status: 409 });
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it("allows a plain customer when check passes", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const updateUserById = vi.fn(async () => ({ error: null }));
    const supabaseUser = {
      rpc: vi.fn(async (name: string) => {
        expect(name).toBe("account_deletion_check");
        return { data: { ok: true }, error: null };
      }),
    };
    const supabaseAdmin = {
      ...adminRoleClient(false),
      rpc: vi.fn(async () => ({ data: { storage_paths: [] }, error: null })),
      storage: { from: vi.fn(() => ({ remove })) },
      auth: { admin: { updateUserById } },
    };

    const result = await runAccountDeletion({
      supabaseUser: supabaseUser as never,
      supabaseAdmin: supabaseAdmin as never,
      userId: "00000000-0000-0000-0000-000000000001",
    });

    expect(result).toEqual({ ok: true });
  });

  it("anonymizes, removes storage, and bans auth on success", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const updateUserById = vi.fn(async () => ({ error: null }));
    const supabaseUser = {
      rpc: vi.fn(async () => ({ data: { ok: true }, error: null })),
    };
    const supabaseAdmin = {
      ...adminRoleClient(false),
      rpc: vi.fn(async () => ({
        data: { storage_paths: [{ bucket: "avatars", path: "x.jpg" }] },
        error: null,
      })),
      storage: { from: vi.fn(() => ({ remove })) },
      auth: { admin: { updateUserById } },
    };

    const result = await runAccountDeletion({
      supabaseUser: supabaseUser as never,
      supabaseAdmin: supabaseAdmin as never,
      userId: "00000000-0000-0000-0000-000000000099",
    });

    expect(result).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(["x.jpg"]);
    expect(updateUserById).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000099",
      expect.objectContaining({
        email: "deleted-00000000-0000-0000-0000-000000000099@famio.local",
        phone: "",
        ban_duration: "876000h",
      }),
    );
  });
});

describe("storage helpers", () => {
  it("groups paths by bucket before remove", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ remove }));
    await removeAnonymizedStorageObjects({ storage: { from } } as never, [
      { bucket: "avatars", path: "a.jpg" },
      { bucket: "avatars", path: "b.jpg" },
      { bucket: "provider-documents", path: "doc.pdf" },
    ]);
    expect(from).toHaveBeenCalledWith("avatars");
    expect(from).toHaveBeenCalledWith("provider-documents");
    expect(remove).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
    expect(remove).toHaveBeenCalledWith(["doc.pdf"]);
  });

  it("sets deleted auth email and ban", async () => {
    const updateUserById = vi.fn(async () => ({ error: null }));
    await finalizeDeletedAuthUser({ auth: { admin: { updateUserById } } }, "abc");
    expect(updateUserById).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ email: "deleted-abc@famio.local", ban_duration: "876000h" }),
    );
  });
});
