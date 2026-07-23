import { describe, expect, it } from "vitest";
import {
  buildPasswordSetupRestartRequired,
  restartRedirectForStep,
  restartStepForPurpose,
} from "../passwordSetupRecovery.server";

describe("password setup restart recovery", () => {
  it("returns restart_required with signup nextStep for signup purpose", () => {
    expect(buildPasswordSetupRestartRequired("signup")).toEqual({
      ok: false,
      error: "restart_required",
      nextStep: "signup",
      message: "We could not finish setting your password. Please verify your phone again.",
    });
  });

  it("returns restart_required with reset nextStep for reset purpose", () => {
    expect(buildPasswordSetupRestartRequired("reset")).toEqual({
      ok: false,
      error: "restart_required",
      nextStep: "reset",
      message: "We could not finish setting your password. Please verify your phone again.",
    });
  });

  it("redirects signup restart to login and reset restart to forgot password", () => {
    expect(restartRedirectForStep("signup")).toBe("/login");
    expect(restartRedirectForStep("reset")).toBe("/auth/forgot");
  });

  it("maps authorization purpose to restart step", () => {
    expect(restartStepForPurpose("signup")).toBe("signup");
    expect(restartStepForPurpose("reset")).toBe("reset");
  });

  it("does not expose passwords or tokens in restart_required responses", () => {
    const result = buildPasswordSetupRestartRequired("signup");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("access_token");
    expect(result).not.toHaveProperty("refresh_token");
  });
});

describe("update failure after authorization claim", () => {
  it("uses restart_required instead of retryable update_failed after claim", () => {
    const afterClaimUpdateFailure = buildPasswordSetupRestartRequired("signup");
    expect(afterClaimUpdateFailure.error).toBe("restart_required");
    expect(afterClaimUpdateFailure).not.toHaveProperty("error", "update_failed");
  });
});
