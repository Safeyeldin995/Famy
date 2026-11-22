/** Investor demo only — never enable in production store builds. */
export const DEMO_APPLE_PAY_METHOD_ID = "__demo_apple_pay__";

export function demoPaymentsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEMO_PAYMENTS === "1";
}