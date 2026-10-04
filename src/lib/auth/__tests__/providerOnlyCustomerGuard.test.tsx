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

async function runGuard(state: {
  loading: boolean;
  rolesLoading?: boolean;
  rolesError?: boolean;
  roles: string[];
}) {
  Object.assign(authState, {
    rolesLoading: false,
    rolesError: false,
    ...state,
  });
  navigate.mockClear();
  const { useProviderOnlyCustomerRedirect, isProviderOnlyCustomerPortalBlocked } =
    await import("@/lib/auth/providerOnlyCustomerGuard");
  const { result } = renderHook(() => useProviderOnlyCustomerRedirect());
  const shouldRedirect =
    !state.loading &&
    !state.rolesLoading &&
    !state.rolesError &&
    isProviderOnlyCustomerPortalBlocked(state.roles as never);
  if (shouldRedirect) {
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/pro", replace: true }));
  } else {
    await waitFor(() => expect(navigate).not.toHaveBeenCalled());
  }
  return { result: result.current, isProviderOnlyCustomerPortalBlocked };
}

describe("isProviderOnlyCustomerPortalBlocked", () => {
  it("blocks provider-only accounts from customer routes", async () => {
    const { isProviderOnlyCustomerPortalBlocked } =
      await import("@/lib/auth/providerOnlyCustomerGuard");
    expect(isProviderOnlyCustomerPortalBlocked(["provider"])).toBe(true);
  });

  it("allows customer-only, dual-role, and admin users", async () => {
    const { isProviderOnlyCustomerPortalBlocked } =
      await import("@/lib/auth/providerOnlyCustomerGuard");
    expect(isProviderOnlyCustomerPortalBlocked(["customer"])).toBe(false);
    expect(isProviderOnlyCustomerPortalBlocked(["customer", "provider"])).toBe(false);
    expect(isProviderOnlyCustomerPortalBlocked(["admin"])).toBe(false);
    expect(isProviderOnlyCustomerPortalBlocked(["admin", "provider"])).toBe(false);
  });
});

describe("useProviderOnlyCustomerRedirect", () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it("does not redirect while auth is hydrating", async () => {
    const { result } = await runGuard({ loading: true, roles: ["provider"] });
    expect(result.blocking).toBe(true);
  });

  it("does not redirect while roles are loading", async () => {
    const { result } = await runGuard({
      loading: false,
      rolesLoading: true,
      roles: [],
    });
    expect(result.blocking).toBe(true);
  });

  it("redirects provider-only users away from customer routes", async () => {
    const { result } = await runGuard({ loading: false, roles: ["provider"] });
    expect(result.blocking).toBe(true);
  });

  it("lets dual-role users open customer routes", async () => {
    const { result } = await runGuard({ loading: false, roles: ["customer", "provider"] });
    expect(result.blocking).toBe(false);
  });

  it("fails open when role lookup errors so customers are not locked out", async () => {
    const { result } = await runGuard({
      loading: false,
      rolesError: true,
      roles: [],
    });
    expect(result.blocking).toBe(false);
  });

  it("simulates browser back from /pro to /home for provider-only users", async () => {
    const first = await runGuard({ loading: false, roles: ["provider"] });
    expect(first.result.blocking).toBe(true);

    navigate.mockClear();
    const second = await runGuard({ loading: false, roles: ["provider"] });
    expect(second.result.blocking).toBe(true);
  });
});
