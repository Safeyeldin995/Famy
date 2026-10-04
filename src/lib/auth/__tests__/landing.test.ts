import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveLandingForCurrentUser,
  resolvePostPasswordLoginTarget,
  resolveRoleLandingForCurrentUser,
  resolveSplashNavigationTarget,
} from "@/lib/auth/landing";

const getUser = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (...args: unknown[]) => from(...args),
  },
}));

function mockRoles(roles: string[] | null, userId = "user-1") {
  getUser.mockResolvedValue({
    data: { user: roles === null ? null : { id: userId } },
  });
  from.mockReturnValue({
    select: () => ({
      eq: async () => ({ data: roles?.map((role) => ({ role })) ?? [] }),
    }),
  });
}

describe("resolveLandingForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when signed out", async () => {
    mockRoles(null);
    await expect(resolveLandingForCurrentUser()).resolves.toBeNull();
  });

  it("routes admins to the admin home", async () => {
    mockRoles(["admin"]);
    await expect(resolveLandingForCurrentUser()).resolves.toBe("/admin");
  });

  it("routes providers to /pro", async () => {
    mockRoles(["provider"]);
    await expect(resolveLandingForCurrentUser()).resolves.toBe("/pro");
  });

  it("routes customer-only users to /home", async () => {
    mockRoles(["customer"]);
    await expect(resolveLandingForCurrentUser()).resolves.toBe("/home");
  });

  it("prefers admin over provider for dual-role accounts", async () => {
    mockRoles(["provider", "admin"]);
    await expect(resolveLandingForCurrentUser()).resolves.toBe("/admin");
  });

  it("routes dual customer+provider users to /pro", async () => {
    mockRoles(["customer", "provider"]);
    await expect(resolveLandingForCurrentUser()).resolves.toBe("/pro");
  });
});

describe("resolveRoleLandingForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes provider membership for admin+provider accounts", async () => {
    mockRoles(["admin", "provider"]);
    await expect(resolveRoleLandingForCurrentUser()).resolves.toEqual({
      landing: "/admin",
      roles: ["admin", "provider"],
      hasProviderRole: true,
    });
  });
});

describe("resolveSplashNavigationTarget", () => {
  it("keeps onboarding, login, and setup gates ahead of landing", () => {
    expect(
      resolveSplashNavigationTarget({ onboarded: false, landing: "/pro", profileFullName: "Sam" }),
    ).toBe("/onboarding");
    expect(
      resolveSplashNavigationTarget({ onboarded: true, landing: null, profileFullName: "Sam" }),
    ).toBe("/login");
    expect(
      resolveSplashNavigationTarget({ onboarded: true, landing: "/home", profileFullName: null }),
    ).toBe("/setup");
  });

  it.each([
    ["provider-only", "/pro"],
    ["customer-only", "/home"],
    ["admin", "/admin"],
  ] as const)("lands %s on %s", (_label, landing) => {
    expect(
      resolveSplashNavigationTarget({
        onboarded: true,
        landing,
        profileFullName: "Sam Provider",
      }),
    ).toBe(landing);
  });
});

describe("resolvePostPasswordLoginTarget", () => {
  it("lands customer-tab sign-in on the resolved workspace", () => {
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "customer",
        landing: "/home",
        hasProviderRole: false,
      }),
    ).toBe("/home");
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "customer",
        landing: "/pro",
        hasProviderRole: true,
      }),
    ).toBe("/pro");
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "customer",
        landing: "/admin",
        hasProviderRole: true,
      }),
    ).toBe("/admin");
  });

  it("lands provider-tab sign-in on /pro when the account has a provider role", () => {
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "provider",
        landing: "/pro",
        hasProviderRole: true,
      }),
    ).toBe("/pro");
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "provider",
        landing: "/admin",
        hasProviderRole: true,
      }),
    ).toBe("/pro");
  });

  it("blocks provider-tab sign-in when the account is not a provider", () => {
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "provider",
        landing: "/home",
        hasProviderRole: false,
      }),
    ).toBe("provider_account_missing");
    expect(
      resolvePostPasswordLoginTarget({
        loginRole: "provider",
        landing: "/admin",
        hasProviderRole: false,
      }),
    ).toBe("provider_account_missing");
  });
});
