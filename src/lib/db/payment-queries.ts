/**
 * Payments data layer — admin-configurable methods (no gateway integration
 * for Paymob yet). RLS does the heavy lifting; see migrations for who can
 * read/write/update. Payment method selection is validated and snapshotted
 * server-side — see tg_snapshot_payment_method in
 * 20260714120000_configurable_payment_methods.sql.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
      paymentMethodId: string;
      /** Only used to pick the initial status (cash = pending, everything else needs review); the row's actual method details are copied server-side from payment_method_id. */
      methodType: 'cash' | 'manual_transfer' | 'online';
      amount: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const status: PaymentStatus = input.methodType === 'cash' ? 'pending' : 'pending_review';
      const { data, error } = await supabase
        .from('payments')
        .insert({
          booking_id: input.bookingId,
          customer_id: user.id,
          payment_method_id: input.paymentMethodId,
          amount: input.amount,
          currency: 'EGP',
          status: status as any,
        } as any)
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

export async function getSignedProofUrl(path: string) {
  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
