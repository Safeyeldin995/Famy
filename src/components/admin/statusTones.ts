export type AdminTone = "brand" | "success" | "warning" | "danger" | "neutral" | "info";

const TONE_CLASS: Record<AdminTone, string> = {
  brand: "bg-brand/10 text-brand",
  success: "bg-mint/20 text-success",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-100 text-sky-800",
};

export function adminToneClass(tone: AdminTone) {
  return TONE_CLASS[tone];
}

/** Map common booking/payment/case status strings to semantic admin tones. */
export function statusToTone(status: string): AdminTone {
  const s = status.toLowerCase();
  if (["completed", "captured", "approved", "active", "verified", "passed", "resolved", "eligible"].includes(s)) {
    return "success";
  }
  if (["pending", "pending_review", "submitted", "under_review", "scheduled", "draft", "open"].includes(s)) {
    return "warning";
  }
  if (["cancelled", "rejected", "failed", "suspended", "no_show", "disputed", "inactive", "dead"].includes(s)) {
    return "danger";
  }
  if (["confirmed", "in_progress", "on_the_way", "arrived", "in_progress"].includes(s)) {
    return "brand";
  }
  return "neutral";
}
