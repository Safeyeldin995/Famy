/**
 * Admin-configurable promo codes data layer.
 * RLS: promo_codes has no customer-facing SELECT policy at all — the full
 * inventory is never exposed. Customers only ever learn the outcome of a
 * single code via the validate_promo_code() RPC. Admin has full CRUD via
 * promo_codes_admin_all. See migration 20260714150000_secure_promo_codes.sql.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type DiscountType = 'fixed' | 'percentage';
export type ApplicableScope = 'all' | 'categories' | 'services';

export type PromoCodeRow = {
  id: string;
  code: string;
  description_en: string | null;
  description_ar: string | null;
  discount_type: DiscountType;
  discount_value: number;
  maximum_discount: number | null;
  minimum_booking_amount: number;
  starts_at: string | null;
  expires_at: string | null;
  total_usage_limit: number | null;
  usage_limit_per_customer: number | null;
  usage_count: number;
  first_booking_only: boolean;
  applicable_scope: ApplicableScope;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PromoCodeInput = {
  code: string;
  description_en: string | null;
  description_ar: string | null;
  discount_type: DiscountType;
  discount_value: number;
  maximum_discount: number | null;
  minimum_booking_amount: number;
  starts_at: string | null;
  expires_at: string | null;
  total_usage_limit: number | null;
  usage_limit_per_customer: number | null;
  first_booking_only: boolean;
  applicable_scope: ApplicableScope;
  is_active: boolean;
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin', 'promo-codes'] });
}

/** Admin: every promo code regardless of status, newest first. */
export function useAdminPromoCodes() {
  return useQuery({
    queryKey: ['admin', 'promo-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PromoCodeRow[];
    },
  });
}

export function useCreatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoCodeInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('promo_codes')
        .insert({ ...input, created_by: user?.id ?? null } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PromoCodeRow;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdatePromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<PromoCodeInput>) => {
      const { error } = await supabase.from('promo_codes').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useSetPromoCodeActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('promo_codes').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Category/service scope for one promo code, admin-only. */
export function usePromoCodeScope(promoCodeId: string | null) {
  return useQuery({
    enabled: !!promoCodeId,
    queryKey: ['admin', 'promo-codes', promoCodeId, 'scope'],
    queryFn: async () => {
      const [categories, services] = await Promise.all([
        supabase.from('promo_code_categories').select('category_id').eq('promo_code_id', promoCodeId!),
        supabase.from('promo_code_services').select('service_id').eq('promo_code_id', promoCodeId!),
      ]);
      if (categories.error) throw categories.error;
      if (services.error) throw services.error;
      return {
        categoryIds: (categories.data ?? []).map((r) => r.category_id),
        serviceIds: (services.data ?? []).map((r) => r.service_id),
      };
    },
  });
}

/** Replaces the full scope set for a promo code in one call (admin-only). */
export function useSetPromoCodeScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ promoCodeId, categoryIds, serviceIds }: { promoCodeId: string; categoryIds: string[]; serviceIds: string[] }) => {
      const del1 = await supabase.from('promo_code_categories').delete().eq('promo_code_id', promoCodeId);
      if (del1.error) throw del1.error;
      const del2 = await supabase.from('promo_code_services').delete().eq('promo_code_id', promoCodeId);
      if (del2.error) throw del2.error;
      if (categoryIds.length > 0) {
        const ins1 = await supabase.from('promo_code_categories').insert(categoryIds.map((category_id) => ({ promo_code_id: promoCodeId, category_id })));
        if (ins1.error) throw ins1.error;
      }
      if (serviceIds.length > 0) {
        const ins2 = await supabase.from('promo_code_services').insert(serviceIds.map((service_id) => ({ promo_code_id: promoCodeId, service_id })));
        if (ins2.error) throw ins2.error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'promo-codes', vars.promoCodeId, 'scope'] });
    },
  });
}

export type PromoValidationResult =
  | { ok: true; promo_code_id: string; code: string; discount_type: DiscountType; discount_value: number; discount_amount: number; description_en: string | null; description_ar: string | null }
  | { ok: false; reason: string };

/** Customer-facing: validates a single code server-side. Never exposes the
 * broader promo inventory — see validate_promo_code() in the migration. */
export async function validatePromoCode(code: string, serviceId: string | null, subtotal: number): Promise<PromoValidationResult> {
  const { data, error } = await supabase.rpc('validate_promo_code', {
    p_code: code,
    p_service_id: serviceId as any,
    p_subtotal: subtotal,
  });
  if (error) throw error;
  return data as unknown as PromoValidationResult;
}

/** Customer-facing: this customer's own redemption history only (RLS-enforced). */
export function useMyPromoRedemptions() {
  return useQuery({
    queryKey: ['my-promo-redemptions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('promo_code_redemptions')
        .select('*')
        .eq('customer_id', user.id)
        .order('redeemed_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
