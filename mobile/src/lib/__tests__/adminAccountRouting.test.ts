import { describe, expect, it, vi } from "vitest";
import { resolveWorkspace } from "@/lib/workspace";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ role: "admin" }], error: null }),
      }),
    }),
  },
  appConfig: { webOrigin: "https://example.com" },
}));

describe("mobile admin account routing", () => {
  it("resolves admin workspace for admin-only roles", async () => {
    await expect(resolveWorkspace("user-1")).resolves.toEqual({
      workspace: "admin",
      roles: ["admin"],
    });
  });
});