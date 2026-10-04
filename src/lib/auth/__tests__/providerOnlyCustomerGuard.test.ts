import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const authState = { loading: true, roles: [] as string[] };

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => authState }));

const effects: Array<() => void> = [];
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (fn: () => void) => {
      effects.push(fn);
    },
  };
});

async function runGuard(state: { loading: boolean; roles: string[] }) {
  Object.assign(authState, state);
  effects.length = 0;
  navigate.mockClear();
  const { useProviderOnlyCustomerRedirect, isProviderOnlyCustomerPortalBlocked } =
    await import("@/lib/auth/providerOnlyCustomerGuard");
  const result = useProviderOnlyCustomerRedirect();
  effects.forEach((fn) => fn());
  return { result, isProviderOnlyCustomerPortalBlocked };
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
    vi.resetModules();
  });

  it("does not redirect while auth is hydrating", async () => {
    const { result } = await runGuard({ loading: true, roles: ["provider"] });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.blocking).toBe(true);
  });

  it("redirects provider-only users away from customer routes", async () => {
    const { result } = await runGuard({ loading: false, roles: ["provider"] });
    expect(navigate).toHaveBeenCalledWith({ to: "/pro", replace: true });
    expect(result.blocking).toBe(true);
  });

  it("lets dual-role users open customer routes", async () => {
    const { result } = await runGuard({ loading: false, roles: ["customer", "provider"] });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.blocking).toBe(false);
  });

  it("simulates browser back from /pro to /home for provider-only users", async () => {
    const first = await runGuard({ loading: false, roles: ["provider"] });
    expect(first.result.blocking).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ to: "/pro", replace: true });

    navigate.mockClear();
    const second = await runGuard({ loading: false, roles: ["provider"] });
    expect(second.result.blocking).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ to: "/pro", replace: true });
  });
});
