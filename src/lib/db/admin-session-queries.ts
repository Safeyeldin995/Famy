import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminSessionEvent = {
  id: string;
  booking_id: string;
  participant: "customer" | "provider";
  joined_at: string;
  left_at: string | null;
};

export function useAdminSessionEvents(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["admin-session-events", bookingId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("session_events")
        .select("id, booking_id, participant, joined_at, left_at")
        .eq("booking_id", bookingId!)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminSessionEvent[];
    },
  });
}