import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const navigate = vi.fn();
const authState = {
  loading: true,
  rolesLoading: false,
  rolesError: false,
  roles: [] as string[],
};

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => authState }));

describe("useAdminAccountRedirect", () => {
  beforeEach(() => {
    navigate.mockClear();
    Object.assign(authState, {
      loading: false,
      rolesLoading: false,
      rolesError: false,
      roles: ["admin"],
    });
  });

  it("redirects admin accounts to /admin", async () => {
    const { useAdminAccountRedirect } = await import("@/lib/auth/adminAccountGuard");
    const { result } = renderHook(() => useAdminAccountRedirect());
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/admin", replace: true }),
    );
    expect(result.current.blocking).toBe(true);
  });

  it("does not redirect non-admin users", async () => {
    authState.roles = ["customer"];
    const { useAdminAccountRedirect } = await import("@/lib/auth/adminAccountGuard");
    renderHook(() => useAdminAccountRedirect());
    await waitFor(() => expect(navigate).not.toHaveBeenCalled());
  });
});