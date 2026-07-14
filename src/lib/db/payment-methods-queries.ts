/**
 * Admin-configurable payment methods data layer.
 * RLS: payment_methods_public_read (active rows, any authenticated user) /
 * payment_methods_admin_all (admin full access) — see migration
 * 20260714120000_configurable_payment_methods.sql.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type MethodType = 'cash' | 'manual_transfer' | 'online';

export type PaymentMethodRow = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  instructions_en: string | null;
  instructions_ar: string | null;
  method_type: MethodType;
  is_active: boolean;
  is_default: boolean;
  display_order: number;
  public_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PaymentMethodInput = {
  code: string;
  name_en: string;
  name_ar: string;
  instructions_en: string | null;
  instructions_ar: string | null;
  method_type: MethodType;
  is_active: boolean;
  display_order: number;
  public_config: Record<string, unknown>;
};

/** Customer/provider-facing: active methods only, in display order. */
export function useActivePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
  });
}

/** Admin: every method regardless of status. */
export function useAdminPaymentMethods() {
  return useQuery({
    queryKey: ['admin', 'payment-methods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'payment-methods'] });
  qc.invalidateQueries({ queryKey: ['payment-methods', 'active'] });
}

export function useCreatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentMethodInput) => {
      const { data, error } = await supabase.from('payment_methods').insert(input as any).select().single();
      if (error) throw error;
      return data as PaymentMethodRow;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<PaymentMethodInput>) => {
      const { error } = await supabase.from('payment_methods').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSetPaymentMethodActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('payment_methods').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSetPaymentMethodDisplayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, display_order }: { id: string; display_order: number }) => {
      const { error } = await supabase.from('payment_methods').update({ display_order }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Atomic swap via RPC — see admin_set_default_payment_method in the migration. */
export function useSetDefaultPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('admin_set_default_payment_method', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}
