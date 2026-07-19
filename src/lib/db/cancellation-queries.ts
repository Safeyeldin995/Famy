/**
 * Booking cancellation data layer.
 * RLS: cancellation_reasons_public_read (active rows, any authenticated
 * user) / cancellation_reasons_admin_all (admin full access); booking_cancellations
 * is select-only for the booking's customer/provider/admin — every write goes
 * through the cancel_booking RPC. See migration
 * 20260714220000_booking_cancellation_rules.sql.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type CancellationActorType = 'customer' | 'provider' | 'admin' | 'any';

export type CancellationReasonRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  actor_type: CancellationActorType;
  applicable_statuses: Database['public']['Enums']['booking_status'][];
  requires_note: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type CancellationReasonInput = {
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  actor_type: CancellationActorType;
  requires_note: boolean;
  is_active: boolean;
  display_order: number;
};

/** Customer/provider/admin-facing: active reasons available to that actor, in display order. */
export function useCancellationReasons(actorType: 'customer' | 'provider' | 'admin') {
  return useQuery({
    queryKey: ['cancellation-reasons', actorType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cancellation_reasons')
        .select('*')
        .eq('is_active', true)
        .in('actor_type', [actorType, 'any'])
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CancellationReasonRow[];
    },
  });
}

/** Admin: every reason regardless of status, optionally filtered by actor type. */
export function useAdminCancellationReasons(actorType?: CancellationActorType) {
  return useQuery({
    queryKey: ['admin', 'cancellation-reasons', actorType ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('cancellation_reasons').select('*').order('display_order', { ascending: true });
      if (actorType) q = q.eq('actor_type', actorType);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CancellationReasonRow[];
    },
  });
}

function invalidateReasons(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['cancellation-reasons'] });
  qc.invalidateQueries({ queryKey: ['admin', 'cancellation-reasons'] });
}

export function useCreateCancellationReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancellationReasonInput) => {
      const { data, error } = await supabase.from('cancellation_reasons').insert(input as any).select().single();
      if (error) throw error;
      return data as CancellationReasonRow;
    },
    onSuccess: () => invalidateReasons(qc),
  });
}

export function useUpdateCancellationReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<CancellationReasonInput>) => {
      const { error } = await supabase.from('cancellation_reasons').update(patch as any).eq('id', id).select('id').single();
      if (error) throw error;
    },
    onSuccess: () => invalidateReasons(qc),
  });
}

export function useSetCancellationReasonActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('cancellation_reasons').update({ is_active: active }).eq('id', id).select('id').single();
      if (error) throw error;
    },
    onSuccess: () => invalidateReasons(qc),
  });
}

export function useSetCancellationReasonDisplayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ first, second }: {
      first: { id: string; display_order: number };
      second: { id: string; display_order: number };
    }) => {
      const { data, error } = await supabase.rpc('admin_swap_cancellation_reason_order', {
        p_first_id: first.id,
        p_second_id: second.id,
      });
      if (error) throw error;
      const rows = data ?? [];
      const storedFirst = rows.find((row: any) => row.id === first.id);
      const storedSecond = rows.find((row: any) => row.id === second.id);
      if (rows.length !== 2 || storedFirst?.display_order !== first.display_order || storedSecond?.display_order !== second.display_order) {
        throw new Error('Cancellation reason order swap did not persist atomically.');
      }
    },
    onSuccess: () => invalidateReasons(qc),
  });
}

/** The one atomic cancellation path for customer, provider and admin alike —
 * see cancel_booking() in the migration. Role is derived server-side from
 * the caller's actual relationship to the booking, never trusted from here. */
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; reasonId: string; note?: string }) => {
      const { data, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: input.bookingId,
        p_reason_id: input.reasonId,
        p_note: input.note || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['booking', vars.bookingId] });
      qc.invalidateQueries({ queryKey: ['booking-cancellation', vars.bookingId] });
      qc.invalidateQueries({ queryKey: ['provider-booking', vars.bookingId] });
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['provider-bookings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['payment', vars.bookingId] });
    },
  });
}

export type BookingCancellationRow = {
  id: string;
  booking_id: string;
  previous_status: Database['public']['Enums']['booking_status'];
  cancelled_by_user_id: string;
  cancelled_by_role: 'customer' | 'provider' | 'admin';
  reason_id: string | null;
  reason_code: string;
  reason_name_en: string;
  reason_name_ar: string;
  note: string | null;
  cancelled_at: string;
};

/** The immutable cancellation record for a booking, if it has one. */
export function useBookingCancellation(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['booking-cancellation', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_cancellations')
        .select('*')
        .eq('booking_id', bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data as BookingCancellationRow | null;
    },
  });
}
