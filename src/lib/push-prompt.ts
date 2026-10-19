import { getPushAvailability, isPushConfigured, isPushSupported } from "@/lib/push";

export const PUSH_PROMPT_DISMISSED_KEY = "famy.pushPrompt.dismissed";
export const PUSH_PROMPT_PENDING_CUSTOMER_KEY = "famy.pushPrompt.pendingCustomer";

export type PushPromptAudience = "customer" | "provider";

function readStorage(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

export function isPushPromptDismissed(): boolean {
  return readStorage(PUSH_PROMPT_DISMISSED_KEY) === "1";
}

export function dismissPushPrompt(): void {
  writeStorage(PUSH_PROMPT_DISMISSED_KEY, "1");
  writeStorage(PUSH_PROMPT_PENDING_CUSTOMER_KEY, "");
}

export function markCustomerPushPromptPending(): void {
  if (isPushPromptDismissed()) return;
  writeStorage(PUSH_PROMPT_PENDING_CUSTOMER_KEY, "1");
}

export function clearCustomerPushPromptPending(): void {
  writeStorage(PUSH_PROMPT_PENDING_CUSTOMER_KEY, "");
}

export function isCustomerPushPromptPending(): boolean {
  return readStorage(PUSH_PROMPT_PENDING_CUSTOMER_KEY) === "1";
}

export function shouldOfferPushPrompt(
  audience: PushPromptAudience,
  options: { hasDeviceSubscription?: boolean } = {},
): boolean {
  if (!isPushConfigured() || !isPushSupported()) return false;
  if (getPushAvailability() !== "default") return false;
  if (isPushPromptDismissed()) return false;
  if (options.hasDeviceSubscription) return false;
  if (audience === "customer") return isCustomerPushPromptPending();
  return true;
}
