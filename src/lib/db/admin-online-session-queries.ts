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

export function useAdminOnlineSessionReviews(status: "open" | "resolved" | "dismissed" = "open") {
  return useQuery({
    queryKey: ["admin", "online-session-reviews", status],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("online_session_admin_reviews")
        .select("id, booking_id, reason, overlap_minutes, status, created_at")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as OnlineSessionReviewRow[];
    },
  });
}