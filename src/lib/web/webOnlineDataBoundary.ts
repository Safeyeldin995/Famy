import { isOnlineServiceMode } from "@/lib/online/serviceMode";

export type WebOnlineBoundaryCode = "not_online_booking" | "not_participant";

export type WebOnlineBoundaryResult =
  | { ok: true }
  | { ok: false; code: WebOnlineBoundaryCode };

type ServiceModeRow = { service_mode?: string | null };

/**
 * P1 (#398): every web-reachable booking read must enforce service_mode = online.
 */
export function assertWebOnlineBookingRow(
  row: ServiceModeRow | null | undefined,
): WebOnlineBoundaryResult {
  if (!row || !isOnlineServiceMode(row.service_mode ?? undefined)) {
    return { ok: false, code: "not_online_booking" };
  }
  return { ok: true };
}

export function filterWebOnlineBookingRows<T extends ServiceModeRow>(rows: T[]): T[] {
  return rows.filter((row) => isOnlineServiceMode(row.service_mode ?? undefined));
}

const IN_PERSON_WEB_REDACT_KEYS = [
  "address_id",
  "full_address",
  "service_address",
  "customer_address",
  "private_phone",
  "reference_phone",
] as const;

/** Strip in-person-only fields from web JSON (defense in depth after SQL filters). */
export function redactInPersonFieldsForWeb<T extends Record<string, unknown>>(row: T): T {
  const next = { ...row };
  for (const key of IN_PERSON_WEB_REDACT_KEYS) {
    if (key in next) {
      delete next[key];
    }
  }
  return next;
}