import { describe, expect, it, vi, beforeEach } from "vitest";

const navigate = vi.fn();
const authState = { loading: true, isAuthenticated: false };

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => authState }));

// Minimal effect runner: useRequireAuth uses exactly one useEffect.
const effects: Array<() => void> = [];
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: (fn: () => void) => { effects.push(fn); } };
});

async function run(state: { loading: boolean; isAuthenticated: boolean }) {
  Object.assign(authState, state);
  effects.length = 0;
  navigate.mockClear();
  const { useRequireAuth } = await import("@/lib/auth/useRequireAuth");
  const result = useRequireAuth();
  effects.forEach((fn) => fn());
  return result;
}

describe("useRequireAuth", () => {
  beforeEach(() => { vi.resetModules(); });

  it("does not redirect while the session is still hydrating", async () => {
    const r = await run({ loading: true, isAuthenticated: false });
    expect(navigate).not.toHaveBeenCalled();
    expect(r.checking).toBe(true);
  });

  it("redirects once hydration finishes with no session", async () => {
    const r = await run({ loading: false, isAuthenticated: false });
    expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
    expect(r.checking).toBe(true);
  });

  it("lets a signed-in user through without redirecting", async () => {
    const r = await run({ loading: false, isAuthenticated: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(r.checking).toBe(false);
  });
});
