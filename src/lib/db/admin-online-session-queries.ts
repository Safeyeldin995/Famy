import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OnlineSessionReviewRow = {
  id: string;
  booking_id: string;
  reason: string;
  /** Attendance outcome code (e.g. admin_review_overlap); never shown to the admin as-is. */
  outcome: string | null;
  overlap_minutes: number | null;
  required_overlap_minutes: number | null;
  status: string;
  created_at: string;
};

/** Columns that exist on `online_session_admin_reviews`; the overlap lives in `metadata`. */
export const ONLINE_SESSION_REVIEW_SELECT = "id, booking_id, reason, status, metadata, created_at";

type RawReviewRow = {
  id: string;
  booking_id: string;
  reason: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function metadataNumber(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : null;
  return n !== null && Number.isFinite(n) ? n : null;
}

const REASON_OUTCOME_SUFFIX = /:\s*([a-z_]+)\s*$/;

/** The outcome code from metadata, or from the legacy "…: <outcome>" reason text. */
function reviewOutcome(row: RawReviewRow): string | null {
  const fromMeta = row.metadata?.outcome;
  if (typeof fromMeta === "string" && fromMeta.trim() !== "") return fromMeta.trim();
  return REASON_OUTCOME_SUFFIX.exec(row.reason ?? "")?.[1] ?? null;
}

export function mapOnlineSessionReviewRow(row: RawReviewRow): OnlineSessionReviewRow {
  return {
    id: row.id,
    booking_id: row.booking_id,
    reason: row.reason,
    outcome: reviewOutcome(row),
    status: row.status,
    created_at: row.created_at,
    overlap_minutes: metadataNumber(row.metadata?.overlap_minutes),
    required_overlap_minutes: metadataNumber(row.metadata?.required_overlap_minutes),
  };
}

export const ONLINE_SESSION_REVIEW_OUTCOMES = [
  "admin_review_overlap",
  "admin_review_no_events",
  "provider_absent",
  "customer_absent",
  "both_absent",
] as const;

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** Plain-language reason for the admin; never the stored English text or a raw code. */
export function onlineSessionReviewReasonText(t: Translate, row: OnlineSessionReviewRow): string {
  const base = "admin.bookings.onlineReviewReasons";
  if (
    row.outcome === "admin_review_overlap" &&
    row.overlap_minutes !== null &&
    row.required_overlap_minutes !== null
  ) {
    return t(`${base}.overlapMinutes`, {
      overlap: row.overlap_minutes,
      required: row.required_overlap_minutes,
    });
  }
  if (row.outcome && (ONLINE_SESSION_REVIEW_OUTCOMES as readonly string[]).includes(row.outcome)) {
    return t(`${base}.${row.outcome}`);
  }
  return t(`${base}.other`);
}

export function useAdminOnlineSessionReviews(status: "open" | "resolved" | "dismissed" = "open") {
  return useQuery({
    queryKey: ["admin", "online-session-reviews", status],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("online_session_admin_reviews")
        .select(ONLINE_SESSION_REVIEW_SELECT)
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as RawReviewRow[]).map(mapOnlineSessionReviewRow);
    },
  });
}
