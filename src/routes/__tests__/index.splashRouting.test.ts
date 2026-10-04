import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSplashNavigationTarget } from "@/lib/auth/landing";

const indexSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../index.tsx"),
  "utf8",
);

describe("splash routing", () => {
  it("uses the shared landing helper after onboarding/login/setup gates", () => {
    expect(indexSource).toContain("resolveLandingForCurrentUser");
    expect(indexSource).toContain("resolveSplashNavigationTarget");
    expect(indexSource).not.toMatch(/navigate\(\{ to: "\/home", replace: true \}\)/);
  });

  it.each([
    ["provider-only", "/pro"],
    ["customer-only", "/home"],
    ["admin", "/admin"],
    ["customer+provider", "/pro"],
  ] as const)("routes %s splash to %s when profile is complete", (_label, landing) => {
    expect(
      resolveSplashNavigationTarget({
        onboarded: true,
        landing,
        profileFullName: "Complete User",
      }),
    ).toBe(landing);
  });
});
