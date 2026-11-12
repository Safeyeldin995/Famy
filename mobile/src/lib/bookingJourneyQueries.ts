import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useBookingStatusHistory(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["booking-status-history", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_status_history")
        .select("to_status, created_at")
        .eq("booking_id", bookingId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}
