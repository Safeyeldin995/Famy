import { describe, expect, it } from "vitest";
import { mobileAppleSignInConfiguredFromEnv, showGoogleSignInOnMobile } from "../mobileAppleSignIn";

describe("mobileAppleSignInConfiguredFromEnv", () => {
  it("is false until EXPO_PUBLIC_APPLE_SIGNIN_READY=1 or app extra is set", () => {
    expect(mobileAppleSignInConfiguredFromEnv({})).toBe(false);
    expect(
      mobileAppleSignInConfiguredFromEnv({ EXPO_PUBLIC_APPLE_SIGNIN_READY: "1" }),
    ).toBe(true);
    expect(mobileAppleSignInConfiguredFromEnv({ appleSignInReady: true })).toBe(true);
  });
});
describe("showGoogleSignInOnMobile (Apple 4.8)", () => {
  it("hides Google on iOS unless Sign in with Apple is shown too", () => {
    expect(showGoogleSignInOnMobile({ platform: "ios", googleEnabled: true, appleShownOnIos: false })).toBe(false);
    expect(showGoogleSignInOnMobile({ platform: "ios", googleEnabled: true, appleShownOnIos: true })).toBe(true);
  });
  it("shows Google on Android whenever it is enabled", () => {
    expect(showGoogleSignInOnMobile({ platform: "android", googleEnabled: true, appleShownOnIos: false })).toBe(true);
    expect(showGoogleSignInOnMobile({ platform: "android", googleEnabled: false, appleShownOnIos: false })).toBe(false);
  });
});
