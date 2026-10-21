import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CancellationReasonRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  actor_type: string;
  requires_note: boolean;
  is_active: boolean;
  display_order: number;
};

export function useCancellationReasons(actorType: "customer" | "provider" | "admin") {
  return useQuery({
    queryKey: ["cancellation-reasons", actorType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cancellation_reasons")
        .select("*")
        .eq("is_active", true)
        .in("actor_type", [actorType, "any"])
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CancellationReasonRow[];
    },
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reasonId: string; note?: string }) => {
      const { data, error } = await supabase.rpc("cancel_booking", {
        p_booking_id: input.bookingId,
        p_reason_id: input.reasonId,
        p_note: input.note || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["provider-booking", vars.bookingId] });
      qc.invalidateQueries({ queryKey: ["provider-bookings"] });
      qc.invalidateQueries({ queryKey: ["payment", vars.bookingId] });
    },
  });
}

export function useBookingCancellation(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["booking-cancellation", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_cancellations")
        .select("*")
        .eq("booking_id", bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
