import { cancellationPolicyForMode } from "@/lib/customerWallet/cancellationPolicy";

/** Product PO v1: request → confirm → pay → join on web (parity with mobile smooth flow). */
export const ONLINE_LESSON_FLOW_STEPS = ["request", "confirm", "pay", "join"] as const;

export type OnlineLessonFlowStep = (typeof ONLINE_LESSON_FLOW_STEPS)[number];

/** Checkout applies wallet balance before card (one-tap when card saved). */
export const ONLINE_WEB_WALLET_FIRST_CHECKOUT = true;

export function onlineCancellationPolicyForWeb() {
  return cancellationPolicyForMode(null, "online");
}

export function onlineWebCancelPolicySummaryAr(): string {
  const { free_cancel_hours, fee_value, fee_mode } = onlineCancellationPolicyForWeb();
  if (fee_mode === "percent") {
    return `لو لغيت قبل ${free_cancel_hours} ساعات من الحصة، الإلغاء مجاني. بعد كده بتتخصم ${fee_value}% من قيمة الحصة، والباقي يرجع لمحفظتك على فامي.`;
  }
  return `لو لغيت قبل ${free_cancel_hours} ساعات من الحصة، الإلغاء مجاني.`;
}

export function onlineWebCancelPolicySummaryEn(): string {
  const { free_cancel_hours, fee_value, fee_mode } = onlineCancellationPolicyForWeb();
  if (fee_mode === "percent") {
    return `Cancel more than ${free_cancel_hours} hours before the lesson for free. After that, a ${fee_value}% fee applies; the rest is credited to your Famy wallet.`;
  }
  return `Cancel more than ${free_cancel_hours} hours before the lesson for free.`;
}