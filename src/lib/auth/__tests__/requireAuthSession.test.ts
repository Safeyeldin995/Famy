import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession },
  },
}));

describe("requireAuthSession", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("redirects to login when there is no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { requireAuthSession } = await import("@/lib/auth/requireAuthSession");
    await expect(requireAuthSession()).rejects.toMatchObject({
      options: { to: "/login", replace: true },
    });
  });

  it("allows a signed-in session", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "x" } } });
    const { requireAuthSession } = await import("@/lib/auth/requireAuthSession");
    await expect(requireAuthSession()).resolves.toBeUndefined();
  });
});
