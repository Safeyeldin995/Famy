import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OnlineSessionReviewRow = {
  id: string;
  booking_id: string;
  reason: string;
  overlap_minutes: number | null;
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

export function mapOnlineSessionReviewRow(row: RawReviewRow): OnlineSessionReviewRow {
  const raw = row.metadata?.overlap_minutes;
  const overlap =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
  return {
    id: row.id,
    booking_id: row.booking_id,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
    overlap_minutes: overlap !== null && Number.isFinite(overlap) ? overlap : null,
  };
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
