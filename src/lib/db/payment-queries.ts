/**
 * Payments data layer — COD + InstaPay (no gateway integration).
 * RLS does the heavy lifting; see migrations for who can read/write/update.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PaymentMethod = 'cash' | 'instapay';
export type PaymentStatus = 'pending' | 'pending_review' | 'captured' | 'rejected';

export function useBookingPayment(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['payment', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('booking_id', bookingId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bookingId: string;
      method: PaymentMethod;
      amount: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const status: PaymentStatus = input.method === 'cash' ? 'pending' : 'pending_review';
      const { data, error } = await supabase
        .from('payments')
        .insert({
          booking_id: input.bookingId,
          customer_id: user.id,
          method: input.method as any,
          amount: input.amount,
          currency: 'EGP',
          status: status as any,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['payment', v.bookingId] }),
  });
}

export function useUploadPaymentProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, bookingId, file }: { paymentId: string; bookingId: string; file: File }) => {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${bookingId}/proof-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('payment-proofs')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from('payments')
        .update({ proof_path: path, proof_uploaded_at: new Date().toISOString() })
        .eq('id', paymentId);
      if (error) throw error;
      return path;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['payment', v.bookingId] }),
  });
}

export function useCapturePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, bookingId }: { paymentId: string; bookingId: string }) => {
      const { data: booking, error: bookingErr } = await supabase
        .from('bookings')
        .select('status')
        .eq('id', bookingId)
        .single();
      if (bookingErr) throw bookingErr;
      if (booking.status !== 'completed') {
        throw new Error('Payment cannot be captured until the booking is completed.');
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('payments')
        .update({
          status: 'captured' as any,
          captured_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
        })
        .eq('id', paymentId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['payment', v.bookingId] });
      qc.invalidateQueries({ queryKey: ['provider-earnings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard-kpis'] });
    },
  });
}

export function useRejectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; bookingId: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('payments')
        .update({
          status: 'rejected' as any,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
          rejection_reason: reason ?? null,
        })
        .eq('id', paymentId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['payment', v.bookingId] });
      qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard-kpis'] });
    },
  });
}

export function useInstapayReceiver() {
  return useQuery({
    queryKey: ['instapay-receiver'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'instapay_receiver')
        .maybeSingle();
      if (error) throw error;
      return (data?.value as { handle?: string; display_name?: string; note?: string } | null) ?? null;
    },
  });
}

export function useUpdateInstapayReceiver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ handle }: { handle: string }) => {
      const { data: current } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'instapay_receiver')
        .maybeSingle();
      const existing = (current?.value as Record<string, unknown>) ?? {};
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'instapay_receiver', value: { ...existing, handle } }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instapay-receiver'] }),
  });
}

export async function getSignedProofUrl(path: string) {
  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
