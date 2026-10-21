import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useBookingPayment(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["payment", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("booking_id", bookingId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCapturePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, bookingId }: { paymentId: string; bookingId: string }) => {
      const { data: booking, error: bookingErr } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .single();
      if (bookingErr) throw bookingErr;
      if (booking.status !== "completed") {
        throw new Error("Payment cannot be captured until the booking is completed.");
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payments")
        .update({
          status: "captured",
          captured_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
        })
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["payment", v.bookingId] });
      qc.invalidateQueries({ queryKey: ["provider-earnings"] });
    },
  });
}

export function useRejectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      paymentId,
      reason,
    }: {
      paymentId: string;
      bookingId: string;
      reason?: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payments")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
          rejection_reason: reason ?? null,
        })
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["payment", v.bookingId] });
    },
  });
}

export async function getSignedProofUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
