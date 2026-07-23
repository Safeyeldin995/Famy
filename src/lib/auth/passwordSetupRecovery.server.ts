import type { AuthFlowPurpose } from "./authIntent.types";

export type PasswordSetupRestartStep = "signup" | "reset";

export function restartStepForPurpose(purpose: AuthFlowPurpose): PasswordSetupRestartStep {
  return purpose === "reset" ? "reset" : "signup";
}

export function restartRedirectForStep(nextStep: PasswordSetupRestartStep): "/login" | "/auth/forgot" {
  return nextStep === "reset" ? "/auth/forgot" : "/login";
}

export function buildPasswordSetupRestartRequired(purpose: AuthFlowPurpose) {
  const nextStep = restartStepForPurpose(purpose);
  return {
    ok: false as const,
    error: "restart_required" as const,
    nextStep,
    message: "We could not finish setting your password. Please verify your phone again.",
  };
}
