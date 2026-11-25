/**
 * Customer problem reports on a booking: support tickets, disputes and
 * no-show reports. Reads are RLS-scoped to the booking's parties; every write
 * goes through the database RPCs (create_support_ticket, open_booking_dispute,
 * report_no_show), which validate status, ownership and duplicates.
 * Mirrors the website's src/lib/db/case-queries.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CaseRow = {
  id: string;
  booking_id: string;
  status: string;
  reason?: string | null;
  admin_notes?: string | null;
  created_at: string;
};

export type TicketRow = CaseRow & {
  category: string;
  subject: string;
  resolution_notes?: string | null;
};

export type TicketCategory =
  | "payment"
  | "service_quality"
  | "provider_behavior"
  | "booking_issue"
  | "app_issue"
  | "other";

function invalidate(qc: ReturnType<typeof useQueryClient>, bookingId: string) {
  void qc.invalidateQueries({ queryKey: ["booking", bookingId] });
  void qc.invalidateQueries({ queryKey: ["booking-cases", bookingId] });
  void qc.invalidateQueries({ queryKey: ["my-bookings"] });
}

/** All cases for one booking, newest first. */
export function useBookingCases(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ["booking-cases", bookingId],
    queryFn: async () => {
      const [tickets, disputes, noShows] = await Promise.all([
        supabase
          .from("support_tickets")
          .select("id, booking_id, status, category, subject, resolution_notes, created_at")
          .eq("booking_id", bookingId!)
          .order("created_at", { ascending: false }),
        supabase
          .from("disputes")
          .select("id, booking_id, status, reason, admin_notes, created_at")
          .eq("booking_id", bookingId!)
          .order("created_at", { ascending: false }),
        supabase
          .from("no_show_reports")
          .select("id, booking_id, status, reason, admin_notes, created_at")
          .eq("booking_id", bookingId!)
          .order("created_at", { ascending: false }),
      ]);
      if (tickets.error) throw tickets.error;
      if (disputes.error) throw disputes.error;
      if (noShows.error) throw noShows.error;
      return {
        tickets: (tickets.data ?? []) as TicketRow[],
        disputes: (disputes.data ?? []) as CaseRow[],
        noShows: (noShows.data ?? []) as CaseRow[],
      };
    },
  });
}

export function useCreateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bookingId: string;
      category: TicketCategory;
      subject: string;
      description: string;
    }) => {
      const { data, error } = await supabase.rpc("create_support_ticket", {
        p_booking_id: input.bookingId,
        p_category: input.category,
        p_subject: input.subject,
        p_description: input.description,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.bookingId),
  });
}

export function useOpenDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reason: string; description: string }) => {
      const { data, error } = await supabase.rpc("open_booking_dispute", {
        p_booking_id: input.bookingId,
        p_reason: input.reason,
        p_description: input.description,
        p_evidence_paths: [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.bookingId),
  });
}

export function useReportNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("report_no_show", {
        p_booking_id: input.bookingId,
        p_reason: input.reason,
        p_evidence_paths: [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidate(qc, vars.bookingId),
  });
}

/** Cancellation policy for a service mode, from the database's own rule. */
export function useCancellationPolicy(serviceMode: "in_person" | "online" = "in_person") {
  return useQuery({
    queryKey: ["cancellation-policy", serviceMode],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cancellation_policy_for", {
        p_service_mode: serviceMode,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as {
        fee_mode?: string;
        fee_value?: number;
        free_cancel_hours?: number;
      } | null;
    },
  });
}
