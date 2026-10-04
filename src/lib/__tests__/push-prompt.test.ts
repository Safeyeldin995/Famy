import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/push", () => ({
  isPushConfigured: () => true,
  isPushSupported: () => true,
  getPushAvailability: () => "default" as const,
}));

import {
  PUSH_PROMPT_DISMISSED_KEY,
  PUSH_PROMPT_PENDING_CUSTOMER_KEY,
  dismissPushPrompt,
  isCustomerPushPromptPending,
  isPushPromptDismissed,
  markCustomerPushPromptPending,
  shouldOfferPushPrompt,
} from "@/lib/push-prompt";

describe("push prompt storage", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows once for a pending customer until dismissed", () => {
    markCustomerPushPromptPending();
    expect(shouldOfferPushPrompt("customer")).toBe(true);
    dismissPushPrompt();
    expect(isPushPromptDismissed()).toBe(true);
    expect(isCustomerPushPromptPending()).toBe(false);
    expect(shouldOfferPushPrompt("customer")).toBe(false);
  });

  it("persists dismiss across pending flag", () => {
    markCustomerPushPromptPending();
    dismissPushPrompt();
    markCustomerPushPromptPending();
    expect(shouldOfferPushPrompt("customer")).toBe(false);
    expect(storage.get(PUSH_PROMPT_DISMISSED_KEY)).toBe("1");
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => markCustomerPushPromptPending()).not.toThrow();
    expect(() => dismissPushPrompt()).not.toThrow();
    expect(isPushPromptDismissed()).toBe(false);
    expect(storage.get(PUSH_PROMPT_PENDING_CUSTOMER_KEY)).toBeUndefined();
  });
});
