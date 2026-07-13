/**
 * Famy Provider Portal data-access hooks.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ---------- Identity ----------
export function useMyRole() {
  return useQuery({
    queryKey: ['my-role'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      const roles = (data ?? []).map((r) => r.role);
      if (roles.includes('admin')) return 'admin' as const;
      if (roles.includes('provider')) return 'provider' as const;
      return 'customer' as const;
    },
  });
}

export function useMyProvider() {
  return useQuery({
    queryKey: ['my-provider'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('providers')
        .select(`*, profile:profiles(*), ratings:ratings_summary(*), trust:trust_scores(*)`)
        .eq('profile_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ---------- Become a provider (onboarding step 1) ----------
export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      bio_en?: string;
      bio_ar?: string;
      years_experience: number;
      hourly_rate: number;
      city: string;
      languages: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');

      const { error: roleErr } = await supabase
        .from('user_roles')
        .insert({ user_id: user.id, role: 'provider' });
      if (roleErr && (roleErr as any).code !== '23505') throw roleErr;

      const { data, error } = await supabase
        .from('providers')
        .insert({
          profile_id: user.id,
          bio_en: input.bio_en ?? '',
          bio_ar: input.bio_ar ?? '',
          years_experience: input.years_experience,
          hourly_rate: input.hourly_rate,
          city: input.city,
          country: 'EG',
          languages: input.languages,
          is_active: true,
          is_verified: false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-provider'] });
      qc.invalidateQueries({ queryKey: ['my-role'] });
    },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { error } = await supabase
        .from('providers')
        .update(patch as any)
        .eq('profile_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-provider'] }),
  });
}

// ---------- Bookings (provider side) ----------
export function useProviderBookings(providerId: string | undefined) {
  // Deliberately no polling and no Realtime subscription here.
  //
  // TanStack Query's default behavior already refetches this query on
  // mount and on window/tab refocus — for a closed beta at expected scale
  // (10-50 users, a handful of providers, low daily booking volume), that
  // means a provider opening or returning to this screen sees any new
  // request within a normal app-usage pattern, with zero added
  // infrastructure.
  //
  // Realtime was evaluated and deliberately rejected for now: it requires
  // publication management, websocket connection/reconnect handling, and
  // subscription lifecycle cleanup — real, ongoing complexity that isn't
  // justified until actual beta usage shows this default refetch behavior
  // is insufflicient. Revisit only if real usage data (not assumption)
  // shows providers missing requests because they leave the screen open
  // and never refocus/remount it.
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-bookings', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          `*, service:services(*), customer:profiles!bookings_customer_id_fkey(full_name, avatar_url, phone), location:booking_locations(*)`,
        )
        .eq('provider_id', providerId!)
        .order('start_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProviderBooking(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['provider-booking', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          `*, service:services(*), customer:profiles!bookings_customer_id_fkey(full_name, avatar_url, phone), location:booking_locations(*), requirement_choices:booking_requirement_selections(*)`,
        )
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useProviderUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
      noShowParty,
    }: { id: string; status: string; reason?: string; noShowParty?: 'customer' | 'provider' }) => {
      const patch: Record<string, unknown> = { status };
      if (status === 'cancelled' && reason) patch.cancellation_reason = reason;
      if (status === 'no_show') {
        patch.no_show_party = noShowParty;
        if (reason) patch.no_show_reason = reason;
      }
      const { error } = await supabase.from('bookings').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['provider-bookings'] });
      qc.invalidateQueries({ queryKey: ['provider-booking', vars.id] });
      qc.invalidateQueries({ queryKey: ['provider-earnings'] });
      qc.invalidateQueries({ queryKey: ['payment', vars.id] });
    },
  });
}

// ---------- Earnings ----------
// Sums ONLY captured payments (cash or instapay). Pending / pending_review / rejected
// are not counted as earned revenue. Upcoming pipeline = bookings confirmed/in_progress
// whose payment is not yet captured.
export function useProviderEarnings(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-earnings', providerId],
    queryFn: async () => {
      // 1) Fetch this provider's bookings + their payment rows (RLS lets the provider read both).
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select('id, price_total, start_at, status, payments(status, amount, captured_at)')
        .eq('provider_id', providerId!);
      if (error) throw error;
      const rows = bookings ?? [];
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const startOf7d = now.getTime() - 7 * 24 * 3600e3;
      let total = 0, mtd = 0, last7 = 0, completedCount = 0, upcoming = 0;
      for (const b of rows as any[]) {
        const captured = (b.payments ?? []).find((p: any) => p.status === 'captured');
        const isUpcoming = ['confirmed', 'in_progress', 'pending'].includes(b.status);
        if (captured) {
          const amt = Number(captured.amount ?? b.price_total ?? 0);
          const t = new Date(captured.captured_at ?? b.start_at).getTime();
          total += amt;
          if (b.status === 'completed') completedCount++;
          if (t >= startOfMonth) mtd += amt;
          if (t >= startOf7d) last7 += amt;
        } else if (isUpcoming) {
          upcoming += Number(b.price_total ?? 0);
        }
      }
      return { total, mtd, last7, completedCount, upcomingPipeline: upcoming };
    },
  });
}

// ---------- Availability ----------
export function useProviderAvailability(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-availability', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_rules')
        .select('*')
        .eq('provider_id', providerId!)
        .order('weekday');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useReplaceAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      rules,
    }: {
      providerId: string;
      rules: { weekday: number; start_time: string; end_time: string }[];
    }) => {
      await supabase.from('availability_rules').delete().eq('provider_id', providerId);
      if (rules.length === 0) return;
      const { error } = await supabase
        .from('availability_rules')
        .insert(rules.map((r) => ({ ...r, provider_id: providerId, timezone: 'Africa/Cairo' })));
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-availability', vars.providerId] }),
  });
}

// ---------- Vacation ----------
export function useProviderVacations(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-vacations', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_vacations')
        .select('*')
        .eq('provider_id', providerId!)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; start_date: string; end_date: string; reason?: string }) => {
      const { error } = await supabase.from('provider_vacations').insert({
        provider_id: input.providerId,
        start_date: input.start_date,
        end_date: input.end_date,
        reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-vacations', vars.providerId] }),
  });
}

export function useDeleteVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, providerId: _ }: { id: string; providerId: string }) => {
      const { error } = await supabase.from('provider_vacations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-vacations', vars.providerId] }),
  });
}

// ---------- Single-day exceptions (holidays / one-off blocked days) ----------
// Reuses availability_exceptions — present since the initial schema but
// previously unwired anywhere in the app.
export function useProviderExceptions(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-exceptions', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .select('*')
        .eq('provider_id', providerId!)
        .order('date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; date: string; reason?: string }) => {
      const { error } = await supabase.from('availability_exceptions').insert({
        provider_id: input.providerId,
        date: input.date,
        is_blocked: true,
        reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-exceptions', vars.providerId] }),
  });
}

export function useDeleteException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, providerId: _ }: { id: string; providerId: string }) => {
      const { error } = await supabase.from('availability_exceptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-exceptions', vars.providerId] }),
  });
}

// ---------- Documents ----------
export function useProviderDocuments(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-documents', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_documents')
        .select('*')
        .eq('provider_id', providerId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      type,
      file,
    }: {
      providerId: string;
      type: string;
      file: File;
    }) => {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${providerId}/${type}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('provider-documents')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('provider_documents').insert({
        provider_id: providerId,
        type: type as any,
        storage_path: path,
        status: 'pending',
      });
      if (dbErr) throw dbErr;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['provider-documents', vars.providerId] }),
  });
}

export async function getSignedDocumentUrl(path: string) {
  const { data, error } = await supabase.storage
    .from('provider-documents')
    .createSignedUrl(path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

// ---------- Service requirements (provider declaration + evidence) ----------
// Status can only ever be set by admin (trg_guard_requirement_fulfillment) —
// a provider write here is silently kept at 'pending' regardless of what it
// sends, so there is no self-approval path even via a direct API call.
export function useRequirementsForService(serviceId: string | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ['service-requirements', serviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_requirements')
        .select('*')
        .eq('service_id', serviceId!)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyRequirementFulfillments(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['my-requirement-fulfillments', providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_requirement_fulfillments')
        .select('*')
        .eq('provider_id', providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDeclareRequirement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, requirementId, notes }: { providerId: string; requirementId: string; notes?: string }) => {
      const { error } = await supabase
        .from('provider_requirement_fulfillments')
        .upsert({ provider_id: providerId, requirement_id: requirementId, notes: notes ?? null }, { onConflict: 'provider_id,requirement_id' });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['my-requirement-fulfillments', vars.providerId] }),
  });
}

export function useUploadRequirementEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, requirementId, file }: { providerId: string; requirementId: string; file: File }) => {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${providerId}/requirement-${requirementId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('provider-documents')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from('provider_requirement_fulfillments')
        .upsert({ provider_id: providerId, requirement_id: requirementId, evidence_storage_path: path }, { onConflict: 'provider_id,requirement_id' });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['my-requirement-fulfillments', vars.providerId] }),
  });
}

// ---------- Provider services management ----------
export function useAllServices() {
  return useQuery({
    queryKey: ['all-services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*, category:categories(slug, name_en, name_ar)')
        .eq('is_active', true)
        .order('name_en');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyProviderServices(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['my-provider-services', providerId],
    queryFn: async () => {
      // Joins the service (not just its id) so the profile screen can still
      // show an already-assigned service that admin later deactivated,
      // labeled unavailable, without dropping the underlying row.
      const { data, error } = await supabase
        .from('provider_services')
        .select('service_id, price_override, status, service:services(id, name_en, name_ar, is_active, provider_pricing_allowed, minimum_price, maximum_price, category:categories(name_en, name_ar))')
        .eq('provider_id', providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useToggleProviderService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      providerId,
      serviceId,
      on,
    }: { providerId: string; serviceId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('provider_services')
          .insert({ provider_id: providerId, service_id: serviceId });
        if (error && (error as any).code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('provider_services')
          .delete()
          .eq('provider_id', providerId)
          .eq('service_id', serviceId);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['my-provider-services', vars.providerId] }),
  });
}

// Provider-set custom price for one of their services. The database
// (trg_validate_provider_price) is the authoritative check against the
// service's provider_pricing_allowed / minimum_price / maximum_price —
// this can never be bypassed by calling the API directly.
export function useSetProviderPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ providerId, serviceId, price }: { providerId: string; serviceId: string; price: number | null }) => {
      const { error } = await supabase
        .from('provider_services')
        .update({ price_override: price })
        .eq('provider_id', providerId)
        .eq('service_id', serviceId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['my-provider-services', vars.providerId] }),
  });
}
