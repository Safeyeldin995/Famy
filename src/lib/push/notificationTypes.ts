/**
 * Canonical list of in-app / push notification `type` values emitted by DB triggers.
 * Keep in sync with INSERTs into public.notifications in supabase/migrations.
 */
export type NotificationCategory =
  | "booking"
  | "chat"
  | "reminder"
  | "support"
  | "campaign"
  | "system"
  | "provider";

export type FamyNotificationType =
  | "booking_request"
  | "booking_confirmed"
  | "booking_on_the_way"
  | "booking_arrived"
  | "booking_arrival_confirmed"
  | "booking_in_progress"
  | "booking_completion_requested"
  | "booking_completed"
  | "booking_disputed"
  | "booking_no_show"
  | "booking_declined"
  | "booking_cancelled"
  | "booking_expired"
  | "booking_reminder"
  | "chat_message"
  | "campaign"
  | "provider_onboarding_approved"
  | "provider_onboarding_rejected"
  | "provider_onboarding_needs_changes"
  | "provider_service_approved"
  | "provider_service_rejected"
  | "provider_section_rejected"
  | "provider_price_change_approved"
  | "provider_price_change_rejected"
  | "teaching_capability_pending"
  | "teaching_capability_approved"
  | "teaching_capability_rejected";

export type NotificationTypeRow = {
  type: FamyNotificationType;
  category: NotificationCategory;
  /** Typical web deep_link path (before mobile mapping). */
  typicalDeepLink: string;
  recipient: "customer" | "provider" | "both";
};

/** Table for PR / docs; not used at runtime for routing. */
export const NOTIFICATION_TYPE_INVENTORY: readonly NotificationTypeRow[] = [
  { type: "booking_request", category: "booking", typicalDeepLink: "/pro/booking/{id}", recipient: "provider" },
  { type: "booking_confirmed", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_on_the_way", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_arrived", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_arrival_confirmed", category: "booking", typicalDeepLink: "/pro/booking/{id}", recipient: "provider" },
  { type: "booking_in_progress", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_completion_requested", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_completed", category: "booking", typicalDeepLink: "/pro/booking/{id}", recipient: "provider" },
  { type: "booking_disputed", category: "booking", typicalDeepLink: "/pro/booking/{id}", recipient: "provider" },
  { type: "booking_no_show", category: "booking", typicalDeepLink: "/booking/{id} or /pro/booking/{id}", recipient: "both" },
  { type: "booking_declined", category: "booking", typicalDeepLink: "/booking/{id}", recipient: "customer" },
  { type: "booking_cancelled", category: "booking", typicalDeepLink: "/booking/{id} or /pro/booking/{id}", recipient: "both" },
  { type: "booking_expired", category: "booking", typicalDeepLink: "/booking/{id} or /pro/booking/{id}", recipient: "both" },
  { type: "booking_reminder", category: "reminder", typicalDeepLink: "/booking/{id} or /pro/booking/{id}", recipient: "both" },
  { type: "chat_message", category: "chat", typicalDeepLink: "/messages/{conversationId}", recipient: "both" },
  { type: "campaign", category: "campaign", typicalDeepLink: "/home or /pro", recipient: "both" },
  { type: "provider_onboarding_approved", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "provider_onboarding_rejected", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "provider_onboarding_needs_changes", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "provider_service_approved", category: "provider", typicalDeepLink: "/pro/profile", recipient: "provider" },
  { type: "provider_service_rejected", category: "provider", typicalDeepLink: "/pro/profile", recipient: "provider" },
  { type: "provider_section_rejected", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "provider_price_change_approved", category: "provider", typicalDeepLink: "/pro/profile", recipient: "provider" },
  { type: "provider_price_change_rejected", category: "provider", typicalDeepLink: "/pro/profile", recipient: "provider" },
  { type: "teaching_capability_pending", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "teaching_capability_approved", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
  { type: "teaching_capability_rejected", category: "provider", typicalDeepLink: "/pro/onboarding", recipient: "provider" },
] as const;
