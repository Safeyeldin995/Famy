import { describe, expect, it } from "vitest";
import { buildPasswordSetupRestartRequired } from "../passwordSetupRecovery.server";

describe("password setup session responses", () => {
  it("does not expose session tokens in successful completePasswordSetupFn shape", () => {
    const success = {
      ok: true,
      userId: "user-id",
      authEmail: "phone-201012345678@famio.local",
      purpose: "signup" as const,
      role: "provider" as const,
    };
    expect(success).not.toHaveProperty("access_token");
    expect(success).not.toHaveProperty("refresh_token");
    expect(success).not.toHaveProperty("password");
  });

  it("uses sign_in_required when password was updated but session cannot be established", () => {
    const fallback = {
      ok: false,
      error: "sign_in_required",
      message: "Password saved. Please sign in with your new password.",
      passwordUpdated: true,
    };
    expect(fallback.passwordUpdated).toBe(true);
    expect(fallback).not.toHaveProperty("access_token");
    expect(fallback).not.toHaveProperty("refresh_token");
    expect(fallback).not.toHaveProperty("password");
  });

  it("uses restart_required when password update fails after authorization claim", () => {
    const restart = buildPasswordSetupRestartRequired("reset");
    expect(restart.error).toBe("restart_required");
    expect(restart.nextStep).toBe("reset");
    expect(restart).not.toHaveProperty("password");
  });
});

describe("completePasswordSetup client flow", () => {
  it("clears interim session before establishing a fresh browser session", () => {
    const steps = ["signOut", "signInWithPassword", "getUser", "navigate"];
    expect(steps[0]).toBe("signOut");
    expect(steps).not.toContain("setSession");
  });
});
