/**
 * Support tickets, disputes and no-show reports — Famy Patch 4 / Module 1.
 * Disputes/no-show reports are select-only for the booking's customer/
 * provider/admin; every write goes through the open_booking_dispute /
 * report_no_show / admin_resolve_* RPCs. Support tickets are opened via
 * create_support_ticket (RPC) and only ever updated by an admin (RLS).
 * See migration 20260716010000_support_disputes_no_show.sql.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type CaseStatus = 'open' | 'info_requested' | 'resolved' | 'rejected';
export type TicketStatus = Database['public']['Enums']['ticket_status'];
export type TicketCategory = 'payment' | 'service_quality' | 'provider_behavior' | 'booking_issue' | 'app_issue' | 'other';

export type SupportTicketRow = {
  id: string;
  booking_id: string;
  user_id: string;
  opened_by_role: 'customer' | 'provider';
  category: TicketCategory;
  subject: string;
  description: string;
  status: TicketStatus;
  assigned_admin_id: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type TicketMessageRow = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: 'customer' | 'provider' | 'admin';
  body: string;
  created_at: string;
};

export type DisputeRow = {
  id: string;
  booking_id: string;
  opened_by: string;
  opened_by_role: 'customer' | 'provider';
  previous_status: Database['public']['Enums']['booking_status'];
  reason: string;
  description: string;
  evidence_paths: string[];
  status: CaseStatus;
  admin_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NoShowReportRow = {
  id: string;
  booking_id: string;
  reported_by: string;
  reporter_role: 'customer' | 'provider';
  reported_party: 'customer' | 'provider';
  previous_status: Database['public']['Enums']['booking_status'];
  reason: string;
  evidence_paths: string[];
  status: CaseStatus;
  admin_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE_CASE_STATUSES: CaseStatus[] = ['open', 'info_requested'];
const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['open', 'pending'];

function invalidateBookingCaseQueries(qc: ReturnType<typeof useQueryClient>, bookingId: string) {
  qc.invalidateQueries({ queryKey: ['booking', bookingId] });
  qc.invalidateQueries({ queryKey: ['provider-booking', bookingId] });
  qc.invalidateQueries({ queryKey: ['booking-support-tickets', bookingId] });
  qc.invalidateQueries({ queryKey: ['booking-disputes', bookingId] });
  qc.invalidateQueries({ queryKey: ['booking-no-show-reports', bookingId] });
  qc.invalidateQueries({ queryKey: ['my-bookings'] });
  qc.invalidateQueries({ queryKey: ['provider-bookings'] });
  qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
}

// ---------- Support tickets ----------

export function useBookingSupportTickets(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['booking-support-tickets', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('booking_id', bookingId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportTicketRow[];
    },
  });
}

export function hasActiveTicket(tickets: SupportTicketRow[] | undefined, category?: TicketCategory) {
  return (tickets ?? []).some((t) => ACTIVE_TICKET_STATUSES.includes(t.status) && (!category || t.category === category));
}

export function useCreateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; category: TicketCategory; subject: string; description: string }) => {
      const { data, error } = await supabase.rpc('create_support_ticket', {
        p_booking_id: input.bookingId,
        p_category: input.category,
        p_subject: input.subject,
        p_description: input.description,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidateBookingCaseQueries(qc, vars.bookingId),
  });
}

export function useTicketMessages(ticketId: string | undefined) {
  return useQuery({
    enabled: !!ticketId,
    queryKey: ['ticket-messages', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TicketMessageRow[];
    },
  });
}

export function useSendTicketMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; body: string }) => {
      // author_id/author_role are stamped server-side by trg_ticket_messages_validate
      // (BEFORE INSERT), never trusted from the client.
      const { error } = await supabase
        .from('ticket_messages')
        .insert({ ticket_id: input.ticketId, body: input.body } as any);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['ticket-messages', vars.ticketId] }),
  });
}

/** Admin: every ticket, optionally filtered. */
export function useAdminSupportTickets(filters?: { status?: TicketStatus; category?: TicketCategory }) {
  return useQuery({
    queryKey: ['admin', 'support-tickets', filters ?? {}],
    queryFn: async () => {
      let q = supabase
        .from('support_tickets')
        .select(`*, booking:bookings(id, customer_id, customer:profiles!bookings_customer_id_fkey(full_name), provider:providers(id, profile:profiles(full_name)))`)
        .order('created_at', { ascending: false })
        .limit(300);
      if (filters?.status) q = q.eq('status', filters.status);
      if (filters?.category) q = q.eq('category', filters.category);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminUpdateSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status?: TicketStatus; assigned_admin_id?: string | null; resolution_notes?: string }) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase.from('support_tickets').update(patch as any).eq('id', id).select('id,status,resolution_notes,resolved_at').single();
      if (error) throw error;
      if (input.status && data.status !== input.status) throw new Error('Support ticket status did not persist.');
      if (input.resolution_notes !== undefined && data.resolution_notes !== input.resolution_notes) {
        throw new Error('Support ticket resolution notes did not persist.');
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'support-tickets'] });
      qc.invalidateQueries({ queryKey: ['booking-support-tickets'] });
    },
  });
}

export function useAdminAssignSupportTicketToMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error('Admin authentication required.');
      const { data, error } = await supabase.from('support_tickets').update({ assigned_admin_id: authData.user.id }).eq('id', id).select('assigned_admin_id').single();
      if (error) throw error;
      if (data.assigned_admin_id !== authData.user.id) throw new Error('Support ticket assignment did not persist.');
      return authData.user.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'support-tickets'] }),
  });
}

// ---------- Disputes ----------

export function useBookingDisputes(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['booking-disputes', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('disputes')
        .select('*')
        .eq('booking_id', bookingId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as DisputeRow[];
    },
  });
}

export function activeDispute(disputes: DisputeRow[] | undefined) {
  return (disputes ?? []).find((d) => ACTIVE_CASE_STATUSES.includes(d.status));
}

export function useOpenDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reason: string; description: string; evidencePaths?: string[] }) => {
      const { data, error } = await supabase.rpc('open_booking_dispute', {
        p_booking_id: input.bookingId,
        p_reason: input.reason,
        p_description: input.description,
        p_evidence_paths: input.evidencePaths ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidateBookingCaseQueries(qc, vars.bookingId),
  });
}

export function useAdminDisputes(filters?: { status?: CaseStatus }) {
  return useQuery({
    queryKey: ['admin', 'disputes', filters ?? {}],
    queryFn: async () => {
      let q = supabase
        .from('disputes')
        .select(`*, booking:bookings(id, status, customer_id, customer:profiles!bookings_customer_id_fkey(full_name), provider:providers(id, profile:profiles(full_name)))`)
        .order('created_at', { ascending: false })
        .limit(300);
      if (filters?.status) q = q.eq('status', filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminResolveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { disputeId: string; status: 'info_requested' | 'resolved' | 'rejected'; adminNotes?: string; bookingStatus?: 'completed' | 'cancelled' }) => {
      const { error } = await supabase.rpc('admin_resolve_dispute', {
        p_dispute_id: input.disputeId,
        p_status: input.status,
        p_admin_notes: input.adminNotes,
        p_booking_status: input.bookingStatus,
      });
      if (error) throw error;
      const { data: stored, error: readError } = await supabase
        .from('disputes')
        .select('id,status,admin_notes,resolved_at')
        .eq('id', input.disputeId)
        .single();
      if (readError) throw readError;
      if (stored.status !== input.status) throw new Error('Dispute resolution did not persist.');
      if (input.adminNotes !== undefined && stored.admin_notes !== input.adminNotes) {
        throw new Error('Dispute resolution notes did not persist.');
      }
      if ((input.status === 'resolved' || input.status === 'rejected') && !stored.resolved_at) {
        throw new Error('Dispute resolution timestamp did not persist.');
      }
      return stored;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'disputes'] });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['booking-disputes'] });
    },
  });
}

// ---------- No-show reports ----------

export function useBookingNoShowReports(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['booking-no-show-reports', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('no_show_reports')
        .select('*')
        .eq('booking_id', bookingId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as NoShowReportRow[];
    },
  });
}

export function activeNoShowReport(reports: NoShowReportRow[] | undefined) {
  return (reports ?? []).find((r) => ACTIVE_CASE_STATUSES.includes(r.status));
}

export function useReportNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reason: string; evidencePaths?: string[] }) => {
      const { data, error } = await supabase.rpc('report_no_show', {
        p_booking_id: input.bookingId,
        p_reason: input.reason,
        p_evidence_paths: input.evidencePaths ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, vars) => invalidateBookingCaseQueries(qc, vars.bookingId),
  });
}

export function useAdminNoShowReports(filters?: { status?: CaseStatus }) {
  return useQuery({
    queryKey: ['admin', 'no-show-reports', filters ?? {}],
    queryFn: async () => {
      let q = supabase
        .from('no_show_reports')
        .select(`*, booking:bookings(id, status, customer_id, customer:profiles!bookings_customer_id_fkey(full_name), provider:providers(id, profile:profiles(full_name)))`)
        .order('created_at', { ascending: false })
        .limit(300);
      if (filters?.status) q = q.eq('status', filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminResolveNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reportId: string; status: 'info_requested' | 'resolved' | 'rejected'; adminNotes?: string; bookingStatus?: 'completed' | 'cancelled' }) => {
      const { error } = await supabase.rpc('admin_resolve_no_show', {
        p_report_id: input.reportId,
        p_status: input.status,
        p_admin_notes: input.adminNotes,
        p_booking_status: input.bookingStatus,
      });
      if (error) throw error;
      const { data: stored, error: readError } = await supabase
        .from('no_show_reports')
        .select('id,status,admin_notes,resolved_at')
        .eq('id', input.reportId)
        .single();
      if (readError) throw readError;
      if (stored.status !== input.status) throw new Error('No-show resolution did not persist.');
      if (input.adminNotes !== undefined && stored.admin_notes !== input.adminNotes) {
        throw new Error('No-show resolution notes did not persist.');
      }
      if ((input.status === 'resolved' || input.status === 'rejected') && !stored.resolved_at) {
        throw new Error('No-show resolution timestamp did not persist.');
      }
      return stored;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'no-show-reports'] });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['booking-no-show-reports'] });
    },
  });
}

// ---------- Evidence (private case-evidence bucket) ----------

export async function uploadCaseEvidence(bookingId: string, file: File) {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${bookingId}/evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('case-evidence').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function getSignedEvidenceUrl(path: string) {
  const { data, error } = await supabase.storage.from('case-evidence').createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
