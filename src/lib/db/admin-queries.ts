import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AdminProviderFilter = "pending" | "verified" | "suspended" | "all";

export function useAdminProviders(filter: AdminProviderFilter = "all") {
  return useQuery({
    queryKey: ['admin', 'providers', filter],
    queryFn: async () => {
      let q = supabase
        .from('providers')
        .select('*, profile:profiles(*), ratings:ratings_summary(*), trust:trust_scores(*)')
        .order('created_at', { ascending: false });
      if (filter === 'pending') q = q.eq('is_verified', false);
      else if (filter === 'verified') q = q.eq('is_verified', true).eq('is_active', true);
      else if (filter === 'suspended') q = q.eq('is_active', false).eq('is_verified', true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetProviderActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('providers')
        .update({ is_active: active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

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
        .select('*, profile:profiles(*), documents:provider_documents(*), services:provider_services(id, status, service:services(id, name_en, name_ar, category:categories(name_en, name_ar)))')
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

export function useSetProviderServiceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerServiceId, status }: { providerServiceId: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase
        .from('provider_services')
        .update({ status } as any)
        .eq('id', providerServiceId);
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
        .select(`
          *,
          customer:profiles!bookings_customer_id_fkey(id, full_name, phone),
          provider:providers(id, profile:profiles(full_name)),
          payments(id, status, method, amount, created_at)
        `)
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard-kpis'] });
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['provider-bookings'] });
    },
  });
}

export function useAdminResolveReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; bookingId: string; action: 'accept' | 'reject'; reason: string }) => {
      const { error } = await supabase.rpc('admin_resolve_reschedule', {
        p_request_id: input.requestId,
        p_action: input.action,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['reschedule-requests', vars.bookingId] });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      qc.invalidateQueries({ queryKey: ['booking', vars.bookingId] });
      qc.invalidateQueries({ queryKey: ['provider-booking', vars.bookingId] });
    },
  });
}

export function useAdminCategories() {
  return useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetCategoryActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('categories').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategoryNames() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name_en, name_ar }: { id: string; name_en: string; name_ar: string }) => {
      const { error } = await supabase.from('categories').update({ name_en, name_ar }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// ---------- Services ----------
// Columns are selected explicitly (never `*`) so `deleted_at` is never
// fetched into a UI-facing query.
const SERVICE_COLUMNS =
  'id, category_id, slug, name_en, name_ar, description_en, description_ar, base_price, duration_min, pricing_model, is_active, minimum_price, maximum_price, maximum_extras_total, provider_pricing_allowed, created_at, updated_at, category:categories(id, slug, name_en, name_ar)';

export type AdminServiceInput = {
  category_id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  base_price: number;
  duration_min: number;
  pricing_model: 'hourly' | 'fixed' | 'per_visit';
  is_active: boolean;
  minimum_price: number | null;
  maximum_price: number | null;
  maximum_extras_total: number | null;
  provider_pricing_allowed: boolean;
};

export function useFlaggedProviderServices(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ['admin', 'flagged-provider-services', serviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_services')
        .select('id, provider_id, price_override, provider:providers(profile:profiles(full_name))')
        .eq('service_id', serviceId!)
        .eq('flagged_for_review', true);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useClearProviderServiceFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; serviceId: string }) => {
      const { error } = await supabase.from('provider_services').update({ flagged_for_review: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['admin', 'flagged-provider-services', vars.serviceId] }),
  });
}

export function useAdminServices() {
  return useQuery({
    queryKey: ['admin', 'services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select(SERVICE_COLUMNS)
        .order('name_en');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminServiceInput) => {
      const { data, error } = await supabase.from('services').insert(input as any).select(SERVICE_COLUMNS).single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'services'] });
      qc.invalidateQueries({ queryKey: ['all-services'] });
    },
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<AdminServiceInput>) => {
      const { error } = await supabase.from('services').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'services'] });
      qc.invalidateQueries({ queryKey: ['all-services'] });
    },
  });
}

export function useSetServiceActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('services').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'services'] });
      qc.invalidateQueries({ queryKey: ['all-services'] });
    },
  });
}

export function useAdminDashboardKpis() {
  return useQuery({
    queryKey: ['admin', 'dashboard-kpis'],
    queryFn: async () => {
      const [revenueRes, activeBookingsRes, pendingBookingsRes, activeProvidersRes, activeCustomersRes] = await Promise.all([
        supabase.from('payments').select('amount').eq('status', 'captured'),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).in('status', ['confirmed', 'in_progress']),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('providers').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('is_verified', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', false),
      ]);
      if (revenueRes.error) throw revenueRes.error;
      if (activeBookingsRes.error) throw activeBookingsRes.error;
      if (pendingBookingsRes.error) throw pendingBookingsRes.error;
      if (activeProvidersRes.error) throw activeProvidersRes.error;
      if (activeCustomersRes.error) throw activeCustomersRes.error;

      const revenue = (revenueRes.data ?? []).reduce((sum, r: any) => sum + Number(r.amount ?? 0), 0);

      return {
        revenue,
        activeBookings: activeBookingsRes.count ?? 0,
        pendingBookings: pendingBookingsRes.count ?? 0,
        activeProviders: activeProvidersRes.count ?? 0,
        activeCustomers: activeCustomersRes.count ?? 0,
      };
    },
  });
}
export function useAdminPayments(status?: string) {
  return useQuery({
    queryKey: ['admin', 'payments', status ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('payments')
        .select(`
          *,
          booking:bookings(
            id,
            status,
            provider:providers(id, profile:profiles(full_name)),
            customer:profiles!bookings_customer_id_fkey(id, full_name, phone)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(300);
      if (status) q = q.eq('status', status as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type AdminCustomerFilter = "all" | "active" | "suspended" | "has_bookings" | "no_bookings";

export function useAdminCustomers(filter: AdminCustomerFilter = "all") {
  return useQuery({
    queryKey: ['admin', 'customers', filter],
    queryFn: async () => {
      let pq = supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (filter === 'active') pq = pq.eq('is_suspended', false);
      else if (filter === 'suspended') pq = pq.eq('is_suspended', true);
      const { data: profiles, error: pErr } = await pq;
      if (pErr) throw pErr;
      const ids = (profiles ?? []).map((p) => p.id);
      if (ids.length === 0) return [];

      const { data: bookings, error: bErr } = await supabase
        .from('bookings')
        .select('customer_id, status')
        .in('customer_id', ids);
      if (bErr) throw bErr;

      const { data: payments, error: payErr } = await supabase
        .from('payments')
        .select('customer_id, amount, status')
        .in('customer_id', ids)
        .eq('status', 'captured');
      if (payErr) throw payErr;

      const rows = (profiles ?? []).map((p) => {
        const myBookings = (bookings ?? []).filter((b) => b.customer_id === p.id);
        const totalBookings = myBookings.length;
        const completedBookings = myBookings.filter((b) => b.status === 'completed').length;
        const cancelledBookings = myBookings.filter((b) => b.status === 'cancelled' || b.status === 'no_show').length;
        const totalSpent = (payments ?? [])
          .filter((pay) => pay.customer_id === p.id)
          .reduce((sum, pay) => sum + Number(pay.amount ?? 0), 0);
        return { ...p, totalBookings, completedBookings, cancelledBookings, totalSpent };
      });

      if (filter === 'has_bookings') return rows.filter((r) => r.totalBookings > 0);
      if (filter === 'no_bookings') return rows.filter((r) => r.totalBookings === 0);
      return rows;
    },
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
        .select('id, status, start_at, price_total')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      const { data: payments } = await supabase
        .from('payments')
        .select('id, booking_id, method, amount, status, created_at')
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      return { profile, bookings: bookings ?? [], payments: payments ?? [] };
    },
    enabled: !!id,
  });
}

export function useSetCustomerSuspended() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, suspended }: { id: string; suspended: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_suspended: suspended })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'customer', vars.id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard-kpis'] });
    },
  });
}

// ---------- Zones ----------
export type AdminZoneInput = {
  name_en: string;
  name_ar: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  travel_fee: number;
  is_active: boolean;
};

export function useAdminZones() {
  return useQuery({
    queryKey: ['admin', 'zones'],
    queryFn: async () => {
      const { data, error } = await supabase.from('zones').select('*').order('name_en');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminZoneInput) => {
      const { data, error } = await supabase.from('zones').insert(input as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'zones'] }),
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<AdminZoneInput>) => {
      const { error } = await supabase.from('zones').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'zones'] }),
  });
}

export function useSetZoneActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('zones').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'zones'] }),
  });
}

export function useZoneServiceCoverage(zoneId: string | undefined) {
  return useQuery({
    enabled: !!zoneId,
    queryKey: ['admin', 'zone-services', zoneId],
    queryFn: async () => {
      const { data, error } = await supabase.from('zone_services').select('service_id').eq('zone_id', zoneId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.service_id));
    },
  });
}

export function useSetZoneService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ zoneId, serviceId, enabled }: { zoneId: string; serviceId: string; enabled: boolean }) => {
      if (enabled) {
        const { error } = await supabase.from('zone_services').insert({ zone_id: zoneId, service_id: serviceId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('zone_services').delete().eq('zone_id', zoneId).eq('service_id', serviceId);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['admin', 'zone-services', vars.zoneId] }),
  });
}

export function useZoneProviderCoverage(zoneId: string | undefined) {
  return useQuery({
    enabled: !!zoneId,
    queryKey: ['admin', 'zone-providers', zoneId],
    queryFn: async () => {
      const { data, error } = await supabase.from('zone_providers').select('provider_id').eq('zone_id', zoneId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.provider_id));
    },
  });
}

export function useSetZoneProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ zoneId, providerId, enabled }: { zoneId: string; providerId: string; enabled: boolean }) => {
      if (enabled) {
        const { error } = await supabase.from('zone_providers').insert({ zone_id: zoneId, provider_id: providerId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('zone_providers').delete().eq('zone_id', zoneId).eq('provider_id', providerId);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['admin', 'zone-providers', vars.zoneId] }),
  });
}
