import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

// Same contracts as src/lib/db/queries.ts. Authorization and scheduling remain server-owned.
export function useRescheduleRequests(bookingId: string) {
  return useQuery({
    queryKey: ["reschedule-requests", bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_reschedule_requests")
        .select("*")
        .eq("booking_id", bookingId)
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
type Action =
  | { type: "request"; start: string; end: string; reason: string }
  | { type: "accept" | "reject" | "withdraw"; requestId: string; reason?: string };
export function useRescheduleAction(bookingId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (action: Action) => {
      const result =
        action.type === "request"
          ? await supabase.rpc("request_reschedule", {
              p_booking_id: bookingId,
              p_proposed_start: action.start,
              p_proposed_end: action.end,
              p_reason: action.reason,
            })
          : action.type === "withdraw"
            ? await supabase.rpc("cancel_reschedule_request", { p_request_id: action.requestId })
            : await supabase.rpc("respond_reschedule", {
                p_request_id: action.requestId,
                p_action: action.type,
                p_reason: action.reason,
              });
      if (result.error) throw result.error;
    },
    onSuccess: () =>
      Promise.all(
        [["reschedule-requests", bookingId], ["booking", bookingId], ["my-bookings"]].map(
          (queryKey) => cache.invalidateQueries({ queryKey }),
        ),
      ),
  });
}
