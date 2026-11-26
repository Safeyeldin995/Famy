export const ADMIN_WORK_QUEUE_KEYS = [
  "new_applications",
  "resubmitted_applications",
  "applications_over_sla",
  "new_service_requests",
  "price_change_requests",
  "pending_services",
  "pending_teaching_groups",
  "pending_documents",
  "documents_expiring_soon",
  "open_cases",
  "bookings_needing_action",
  "online_session_reviews",
  "bookings_lifecycle_attention",
  "payments_pending_review",
  "online_lesson_issue_reports",
  "ugc_reports",
  "pending_settlements",
  "providers_at_cash_limit",
  "tutors_missing_teaching_data",
] as const;

export type AdminWorkQueueKey = (typeof ADMIN_WORK_QUEUE_KEYS)[number];
export type AdminWorkQueueCount = { queue: AdminWorkQueueKey; item_count: number };

export function isProviderWorkQueueKey(value: unknown): value is AdminWorkQueueKey {
  return (
    typeof value === "string" &&
    [
      "new_applications",
      "resubmitted_applications",
      "applications_over_sla",
      "new_service_requests",
      "price_change_requests",
      "pending_services",
      "pending_teaching_groups",
      "pending_documents",
      "tutors_missing_teaching_data",
    ].includes(value)
  );
}

export function normalizeAdminWorkQueueCounts(rows: unknown): Record<AdminWorkQueueKey, number> {
  if (!Array.isArray(rows)) throw new Error("Invalid admin work queue response.");
  const values = new Map<AdminWorkQueueKey, number>();
  for (const row of rows as AdminWorkQueueCount[]) {
    if (!ADMIN_WORK_QUEUE_KEYS.includes(row.queue)) continue;
    const count = Number(row.item_count);
    if (values.has(row.queue) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("Invalid admin work queue count.");
    }
    values.set(row.queue, count);
  }
  if (ADMIN_WORK_QUEUE_KEYS.some((key) => !values.has(key))) {
    throw new Error("Incomplete admin work queue response.");
  }
  return Object.fromEntries(values) as Record<AdminWorkQueueKey, number>;
}
