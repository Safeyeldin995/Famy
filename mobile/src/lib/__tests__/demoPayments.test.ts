import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEMO_APPLE_PAY_METHOD_ID,
  demoPaymentsEnabled,
  demoPaymentsEnabledForBuildEnv,
} from "../demoPayments";

describe("demoPayments", () => {
  const prev = process.env.EXPO_PUBLIC_DEMO_PAYMENTS;

  afterEach(() => {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_DEMO_PAYMENTS;
    else process.env.EXPO_PUBLIC_DEMO_PAYMENTS = prev;
  });

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_DEMO_PAYMENTS;
  });

  it("is off by default (production-safe)", () => {
    expect(demoPaymentsEnabled()).toBe(false);
  });

  it("is on only when EXPO_PUBLIC_DEMO_PAYMENTS=1", () => {
    process.env.EXPO_PUBLIC_DEMO_PAYMENTS = "1";
    expect(demoPaymentsEnabled()).toBe(true);
    process.env.EXPO_PUBLIC_DEMO_PAYMENTS = "0";
    expect(demoPaymentsEnabled()).toBe(false);
  });

  it("uses a stable sentinel id for the demo Apple Pay row", () => {
    expect(DEMO_APPLE_PAY_METHOD_ID.startsWith("__")).toBe(true);
  });

  it("stays off for production EAS profile even when env is 1", () => {
    expect(
      demoPaymentsEnabledForBuildEnv({
        EAS_BUILD_PROFILE: "production",
        EXPO_PUBLIC_DEMO_PAYMENTS: "1",
      }),
    ).toBe(false);
    expect(
      demoPaymentsEnabledForBuildEnv({
        EXPO_PUBLIC_DEMO_PAYMENTS_BUILD_DISABLED: "1",
        EXPO_PUBLIC_DEMO_PAYMENTS: "1",
      }),
    ).toBe(false);
    expect(
      demoPaymentsEnabledForBuildEnv({
        EAS_BUILD_PROFILE: "preview",
        EXPO_PUBLIC_DEMO_PAYMENTS: "1",
      }),
    ).toBe(true);
  });
});