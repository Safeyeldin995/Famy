import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Admin route only. Reads retain the authenticated client's existing table RLS.
export function useAdminBookingHistory(bookingId: string) {
  return useQuery({
    queryKey: ["admin", "booking-history", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_status_history")
        .select("id,to_status,created_at,reason")
        .eq("booking_id", bookingId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}
