/**
 * Famy data-access layer.
 *
 * All Supabase reads/writes are routed through this module so routes stay
 * unaware of the backend transport. Replace mock imports with these hooks.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];

// ---------- My Profile (real Supabase session + profiles table — replaces
// the old Zustand-only `authed`/`profile.name` pattern) ----------
export function useMyProfile() {
  return useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { full_name: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: input.full_name })
        .eq('id', user.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      label: string;
      line1: string;
      line2?: string;
      area?: string;
      city: string;
      country?: string;
      is_default?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('addresses')
        .insert({
          user_id: user.id,
          label: input.label,
          line1: input.line1,
          line2: input.line2 ?? null,
          area: input.area ?? null,
          city: input.city,
          country: input.country ?? 'EG',
          is_default: input.is_default ?? false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
    },
  });
}

// Single default (or most-recent) address for display purposes — e.g. the
// location chip on Home and the "Addresses" row on Profile. Replaces the old
// Zustand `profile.compound` read (no display should depend on local-only
// state per Sprint 1 Phase 2 adjustment #1).
export function useDefaultAddress() {
  return useQuery({
    queryKey: ['default-address'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ---------- Categories ----------
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
  });
}

// ---------- Providers ----------
export function useProviders(opts: { categorySlug?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ['providers', opts],
    queryFn: async () => {
      let q = supabase
        .from('providers')
        .select(
          `id, hourly_rate, years_experience, languages, city, is_top_pro, is_verified, response_time_min,
           profile:profiles(full_name, avatar_url),
           ratings:ratings_summary(rating_avg, rating_count),
           trust:trust_scores(score),
           services:provider_services(service:services(id, slug, name_en, name_ar, category:categories(slug)))`,
        )
        .eq('is_active', true)
        .eq('is_verified', true)
        .limit(opts.limit ?? 50);
      const { data, error } = await q;
      if (error) throw error;
      if (!opts.categorySlug) return data ?? [];
      return (data ?? []).filter((p: any) =>
        p.services?.some((ps: any) => ps.service?.category?.slug === opts.categorySlug),
      );
    },
  });
}

export function useProvider(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['provider', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('providers')
        .select(
          `*, profile:profiles(*), ratings:ratings_summary(*), trust:trust_scores(*),
           services:provider_services(service:services(*)),
           reviews(*)`,
        )
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ---------- Bookings ----------
export function useMyBookings() {
  return useQuery({
    queryKey: ['my-bookings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select(
          `*, service:services(*), provider:providers(*, profile:profiles(full_name, avatar_url))`,
        )
        .eq('customer_id', user.id)
        .order('start_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['booking', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, service:services(*), provider:providers(*, profile:profiles(full_name, avatar_url)), address:addresses(*)`)
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}



export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Tables['bookings']['Insert'], 'customer_id'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('bookings')
        .insert({ ...input, customer_id: user.id })
        .select()
        .single();
      // Postgres exclusion-constraint violation → friendly message
      if (error) {
        if ((error as any).code === '23P01') {
          throw new Error('That time slot was just taken. Please pick another.');
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-bookings'] }),
  });
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Tables['bookings']['Row']['status'] }) => {
      const { error } = await supabase.from('bookings').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-bookings'] }),
  });
}

// ---------- Favorites ----------
export function useFavorites() {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('favorites')
        .select('provider_id, provider:providers(*, profile:profiles(full_name, avatar_url))')
        .eq('user_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, on }: { providerId: string; on: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      if (on) {
        const { error } = await supabase.from('favorites').insert({ user_id: user.id, provider_id: providerId });
        if (error && (error as any).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('provider_id', providerId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['favorites'] });
      qc.invalidateQueries({ queryKey: ['favorite-ids'] });
    },
  });
}

// ---------- Notifications ----------
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Addresses ----------
export function useAddresses() {
  return useQuery({
    queryKey: ['addresses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('addresses').select('*').order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Coupons ----------
export async function validateCoupon(code: string, subtotal: number) {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false as const, reason: 'not_found' };
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false as const, reason: 'expired' };
  if (data.max_uses && data.uses_count >= data.max_uses) return { ok: false as const, reason: 'exhausted' };
  if (subtotal < Number(data.min_total)) return { ok: false as const, reason: 'min_total' };
  const discount =
    data.type === 'percent' ? (subtotal * Number(data.value)) / 100 : Number(data.value);
  return { ok: true as const, coupon: data, discount: Math.min(discount, subtotal) };
}

// ---------- Reviews ----------
export function useProviderReviews(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['reviews', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at')
        .eq('provider_id', providerId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Provider services (for booking) ----------
export function useProviderServices(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-services', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_services')
        .select('price_override, service:services(*, category:categories(slug, name_en, name_ar))')
        .eq('provider_id', providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Notifications ----------
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------- Favorite IDs ----------
export function useFavoriteIds() {
  return useQuery({
    queryKey: ['favorite-ids'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as string[];
      const { data, error } = await supabase
        .from('favorites')
        .select('provider_id')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.provider_id);
    },
  });
}

