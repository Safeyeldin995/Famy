import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

import {
  isOnlineWebProtectedPath,
  requireOnlineWebSession,
  safeOnlineWebReturnTo,
} from "../onlineWebSession";

describe("isOnlineWebProtectedPath", () => {
  it.each([
    ["/online/lessons", true],
    ["/online/lessons/b1", true],
    ["/online/lessons/b1/room", true],
    ["/online/wallet", true],
    ["/online/provider/requests", true],
    ["/online/provider/lessons", true],
    ["/online/tutors/p1/request", true],
    ["/online", false],
    ["/online/tutors", false],
    ["/online/tutors/p1", false],
    ["/online/tutors/p1/request/", true],
    ["/online/login", false],
  ])("%s → %s", (path, expected) => {
    expect(isOnlineWebProtectedPath(path)).toBe(expected);
  });
});

describe("safeOnlineWebReturnTo", () => {
  it("keeps the full online path with its search", () => {
    expect(safeOnlineWebReturnTo("/online/lessons/b1?paymob_return=1", "/online")).toBe(
      "/online/lessons/b1?paymob_return=1",
    );
  });
  it("rejects off-surface and protocol-relative destinations", () => {
    expect(safeOnlineWebReturnTo("https://evil.example", "/online")).toBe("/online");
    expect(safeOnlineWebReturnTo("//evil.example/online/", "/online")).toBe("/online");
    expect(safeOnlineWebReturnTo("/bookings", "/online")).toBe("/online");
    expect(safeOnlineWebReturnTo(undefined, "/online")).toBe("/online");
  });
});

describe("requireOnlineWebSession", () => {
  beforeEach(() => getSession.mockReset());

  it("does not check or redirect during SSR (session lives in browser storage)", async () => {
    await expect(requireOnlineWebSession("/online/lessons/b1", true)).resolves.toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("passes when the browser has a session", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    await expect(requireOnlineWebSession("/online/wallet", false)).resolves.toBeUndefined();
  });

  it("redirects to login keeping the full href (path + search)", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const href = "/online/lessons/b1?paymob_return=1";
    let thrown: unknown;
    try {
      await requireOnlineWebSession(href, false);
    } catch (e) {
      thrown = e;
    }
    const opts = (thrown as { options?: { to?: string; search?: { returnTo?: string } } }).options;
    expect(opts?.to).toBe("/online/login");
    expect(opts?.search?.returnTo).toBe(href);
  });
});
