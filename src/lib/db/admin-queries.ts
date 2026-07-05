import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function usePendingProviders() {
  return useQuery({
    queryKey: ['admin', 'pending-providers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('providers')
        .select('*, profile:profiles(*)')
        .eq('is_verified', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminProvider(id: string) {
  return useQuery({
    queryKey: ['admin', 'provider', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('providers')
        .select('*, profile:profiles(*), documents:provider_documents(*)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useSetProviderVerified() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const { error } = await supabase
        .from('providers')
        .update({ is_verified: verified, is_active: verified })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage
        .from('provider-documents')
        .createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useAdminBookings(status?: string) {
  return useQuery({
    queryKey: ['admin', 'bookings', status ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('bookings')
        .select('*, customer:profiles!bookings_customer_id_fkey(id, full_name, phone), provider:providers(id, profile:profiles(full_name))')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status) q = q.eq('status', status as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('bookings')
        .update({ status: status as any })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
  });
}

export function useAdminCustomer(id: string) {
  return useQuery({
    queryKey: ['admin', 'customer', id],
    queryFn: async () => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      const { data: bookings } = await supabase
        .from('bookings')
        .select('id, status, scheduled_start, price_total')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      return { profile, bookings: bookings ?? [] };
    },
    enabled: !!id,
  });
}
