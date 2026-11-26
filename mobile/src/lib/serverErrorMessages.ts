/**
 * Maps known server error messages (raised in English by Postgres RPCs and
 * RLS) to translation keys, so the app never shows a raw English string.
 * Unknown errors fall back to `common.somethingWentWrong`.
 */

type Rule = { match: RegExp; key: string };

const RESCHEDULE_RULES: Rule[] = [
  { match: /no longer open|already been resolved|cannot be cancelled/i, key: "reschedule.errors.notOpen" },
  { match: /same session length/i, key: "reschedule.errors.sameLength" },
  { match: /can no longer be rescheduled/i, key: "reschedule.errors.notReschedulable" },
  { match: /reason is required/i, key: "reschedule.errors.reasonRequired" },
  {
    match:
      /too close to another booking|unavailable during this time|unavailable on this date|outside the provider|does not meet the provider|too far in the future|span past midnight|SLOT_UNAVAILABLE|exclusion constraint/i,
    key: "reschedule.errors.slotTaken",
  },
  { match: /invalid proposed time|valid counter-proposed time/i, key: "reschedule.errors.invalidTime" },
  { match: /only the (customer|provider)|not found|permission denied|row-level security/i, key: "reschedule.errors.notAllowed" },
];

const PROVIDER_PAYMENT_RULES: Rule[] = [
  { match: /until the booking is completed/i, key: "payment.errors.notCompleted" },
  { match: /permission denied|row-level security|not allowed|admin only/i, key: "payment.errors.notAllowed" },
];

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const parts: string[] = [];
  for (const field of ["message", "details", "hint", "code"] as const) {
    const value = (error as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) parts.push(value);
  }
  return parts.join(" ");
}

function keyFor(error: unknown, rules: Rule[], notAllowedKey: string): string {
  const text = errorText(error);
  for (const rule of rules) if (text && rule.match.test(text)) return rule.key;
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "42501") {
    return notAllowedKey;
  }
  return "common.somethingWentWrong";
}

export function rescheduleErrorKey(error: unknown): string {
  return keyFor(error, RESCHEDULE_RULES, "reschedule.errors.notAllowed");
}

export function providerPaymentErrorKey(error: unknown): string {
  return keyFor(error, PROVIDER_PAYMENT_RULES, "payment.errors.notAllowed");
}
