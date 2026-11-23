/** Investor demo only — never enable in production store builds. */
export const DEMO_APPLE_PAY_METHOD_ID = "__demo_apple_pay__";

export function demoPaymentsEnabledForBuildEnv(env: {
  EAS_BUILD_PROFILE?: string;
  EXPO_PUBLIC_DEMO_PAYMENTS?: string;
  EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED?: string;
}): boolean {
  if (
    env.EAS_BUILD_PROFILE === "production" ||
    env.EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED === "1"
  ) {
    return false;
  }
  return env.EXPO_PUBLIC_DEMO_PAYMENTS === "1";
}

export function demoPaymentsEnabled(): boolean {
  return demoPaymentsEnabledForBuildEnv({
    EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
    EXPO_PUBLIC_DEMO_PAYMENTS: process.env.EXPO_PUBLIC_DEMO_PAYMENTS,
    EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED:
      process.env.EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED,
  });
}