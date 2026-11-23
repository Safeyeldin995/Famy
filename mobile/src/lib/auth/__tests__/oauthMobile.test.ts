import { describe, expect, it } from "vitest";
import { mobileAppleSignInConfiguredFromEnv } from "../mobileAppleSignIn";

describe("mobileAppleSignInConfiguredFromEnv", () => {
  it("is false until EXPO_PUBLIC_APPLE_SIGNIN_READY=1 or app extra is set", () => {
    expect(mobileAppleSignInConfiguredFromEnv({})).toBe(false);
    expect(
      mobileAppleSignInConfiguredFromEnv({ EXPO_PUBLIC_APPLE_SIGNIN_READY: "1" }),
    ).toBe(true);
    expect(mobileAppleSignInConfiguredFromEnv({ appleSignInReady: true })).toBe(true);
  });
});