import { describe, expect, it, vi } from "vitest";
import {
  appleSignInRevokeConfigured,
  revokeAppleSignInAuthorizationCode,
} from "../appleTokenRevocation.server";

describe("appleSignInRevokeConfigured", () => {
  it("is false until all Apple env vars are set", () => {
    expect(appleSignInRevokeConfigured({})).toBe(false);
    expect(
      appleSignInRevokeConfigured({
        APPLE_SIGNIN_CLIENT_ID: "com.famy.app",
        APPLE_TEAM_ID: "TEAM",
        APPLE_KEY_ID: "KEY",
        APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMC4CAQEA\n-----END PRIVATE KEY-----",
      }),
    ).toBe(true);
  });
});

describe("revokeAppleSignInAuthorizationCode", () => {
  it("no-ops without configuration", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
    await revokeAppleSignInAuthorizationCode("code-123", {});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});