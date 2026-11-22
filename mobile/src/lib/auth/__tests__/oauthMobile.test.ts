import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("mobileAppleSignInConfigured", () => {
  const prev = process.env.EXPO_PUBLIC_APPLE_SIGNIN_READY;

  afterEach(() => {
    vi.resetModules();
    if (prev === undefined) delete process.env.EXPO_PUBLIC_APPLE_SIGNIN_READY;
    else process.env.EXPO_PUBLIC_APPLE_SIGNIN_READY = prev;
  });

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EXPO_PUBLIC_APPLE_SIGNIN_READY;
  });

  it("is false until EXPO_PUBLIC_APPLE_SIGNIN_READY=1 or app extra is set", async () => {
    const { mobileAppleSignInConfigured } = await import("../oauth");
    expect(mobileAppleSignInConfigured()).toBe(false);
    process.env.EXPO_PUBLIC_APPLE_SIGNIN_READY = "1";
    vi.resetModules();
    const mod = await import("../oauth");
    expect(mod.mobileAppleSignInConfigured()).toBe(true);
  });
});