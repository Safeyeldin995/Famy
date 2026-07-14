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

export type AddressLabel = 'home' | 'work' | 'family' | 'other';

export type AddressInput = {
  label: AddressLabel;
  custom_label?: string | null;
  city: string;
  area?: string | null;
  street: string;
  building?: string | null;
  floor?: string | null;
  apartment?: string | null;
  compound?: string | null;
  landmark?: string | null;
  access_notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_default?: boolean;
};

// line1/line2 are legacy required-for-compat columns nothing in the UI
// reads anymore — derived here so every write still satisfies the schema.
function toAddressRow(input: AddressInput) {
  const line2Parts = [input.compound, input.building, input.apartment, input.access_notes].filter(
    (v): v is string => !!v && v.trim().length > 0,
  );
  return {
    label: input.label,
    custom_label: input.label === 'other' ? (input.custom_label?.trim() || null) : null,
    city: input.city,
    area: input.area ?? null,
    street: input.street,
    building: input.building ?? null,
    floor: input.floor ?? null,
    apartment: input.apartment ?? null,
    compound: input.compound ?? null,
    landmark: input.landmark ?? null,
    access_notes: input.access_notes ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    line1: input.street,
    line2: line2Parts.length > 0 ? line2Parts.join(' · ') : null,
  };
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddressInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('addresses')
        .insert({ ...toAddressRow(input), user_id: user.id, is_default: input.is_default ?? false })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      qc.invalidateQueries({ queryKey: ['default-address'] });
    },
  });
}

export function useUpdateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddressInput & { id: string }) => {
      const { data, error } = await supabase
        .from('addresses')
        .update(toAddressRow(input))
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      qc.invalidateQueries({ queryKey: ['address'] });
      qc.invalidateQueries({ queryKey: ['default-address'] });
    },
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('addresses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      qc.invalidateQueries({ queryKey: ['default-address'] });
    },
  });
}

export function useSetDefaultAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('addresses').update({ is_default: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      qc.invalidateQueries({ queryKey: ['default-address'] });
    },
  });
}

export function useAddress(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['address', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('addresses').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
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

// ---------- Zones ----------
// Resolves an address's coordinates to the nearest active zone (or none, if
// the point falls outside every active zone's radius) — server-side only,
// via the resolve_zone() RPC (haversine center+radius, no PostGIS on this
// project). This is purely informational for the UI; the same resolution
// runs again, authoritatively, inside the booking-creation DB trigger.
export function useResolveZone(lat: number | null | undefined, lng: number | null | undefined) {
  return useQuery({
    enabled: lat != null && lng != null,
    queryKey: ['resolve-zone', lat, lng],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resolve_zone', { p_lat: lat!, p_lng: lng! });
      if (error) throw error;
      return data?.[0] ?? null;
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
           services:provider_services(status, service:services(id, slug, name_en, name_ar, category:categories(slug)))`,
        )
        .eq('is_active', true)
        .eq('is_verified', true)
        .limit(opts.limit ?? 50);
      const { data, error } = await q;
      if (error) throw error;
      if (!opts.categorySlug) return data ?? [];
      return (data ?? []).filter((p: any) =>
        p.services?.some((ps: any) => ps.service?.category?.slug === opts.categorySlug && ps.status === 'approved'),
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
           services:provider_services(status, service:services(*)),
           reviews(*)`,
        )
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// ---------- Avatars ----------
// Single shared resolver for the private `avatars` storage bucket. Reused
// everywhere an avatar is displayed (customer/provider cards, profile
// screens, booking detail) instead of duplicating the signing logic that
// previously existed only in pro.profile.tsx. The bucket stays private —
// this does not change the security model, it only makes the existing
// signed-URL pattern consistent everywhere.
//
// `raw` is whatever is stored in `avatar_url`: null/undefined (no avatar),
// a full http(s) URL (external fallback, e.g. pravatar — already public,
// returned as-is), or a private storage path (needs signing).
export function useAvatarUrl(raw: string | null | undefined) {
  return useQuery({
    enabled: !!raw,
    // Re-sign automatically once the previous URL's 1-hour expiry is close,
    // rather than only on mount — this is the actual root cause fix for the
    // "sometimes shows old/broken image" glitch (Issue #4): a signed URL
    // rendered once and never refreshed will 403 after an hour with no
    // visible error, which reads as a random flicker.
    queryKey: ['avatar-url', raw],
    staleTime: 45 * 60 * 1000, // refetch a fresh signed URL after 45 min, before the 1h expiry hits
    queryFn: async () => {
      if (!raw) return null;
      if (raw.startsWith("http")) return raw;
      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(raw, 60 * 60);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

// ---------- Availability ----------
const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'on_the_way', 'arrived', 'arrival_confirmed', 'in_progress', 'completion_requested'] as const;

// Resolves a provider's REAL open slots for a given date, replacing the
// hardcoded timeSlots array that previously showed the same fixed times to
// every customer regardless of the provider's actual schedule. Combines:
//   1. availability_rules (weekly recurring pattern, by weekday)
//   2. provider_vacations (date-range blocks) + availability_exceptions (single-day/partial blocks)
//   3. providers.vacation_mode / min_notice_hours / max_advance_days / buffer_minutes
//   4. existing active bookings that day (to exclude already-taken times, with buffer)
// The database's own exclusion constraint + BEFORE INSERT validation trigger
// on `bookings` remain the final, authoritative safety net if two customers
// race for the same slot — this function is a UX layer on top of that.
export function useAvailableSlots(providerId: string | undefined, date: Date | null, slotMinutes = 120) {
  return useQuery({
    enabled: !!providerId && !!date,
    queryKey: ['available-slots', providerId, date?.toDateString()],
    queryFn: async () => {
      const d = date!;
      const weekday = d.getDay();
      const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
      const dateStr = dayStart.toISOString().slice(0, 10);

      const [providerRes, rulesRes, vacRes, excRes, bookingsRes] = await Promise.all([
        supabase.from('providers').select('vacation_mode, min_notice_hours, max_advance_days, buffer_minutes').eq('id', providerId!).single(),
        supabase.from('availability_rules').select('start_time, end_time').eq('provider_id', providerId!).eq('weekday', weekday),
        supabase.from('provider_vacations').select('start_date, end_date').eq('provider_id', providerId!).lte('start_date', dateStr).gte('end_date', dateStr),
        supabase.from('availability_exceptions').select('start_time, end_time, is_blocked, date, end_date').eq('provider_id', providerId!)
          .lte('date', dateStr),
        supabase.from('bookings').select('start_at, end_at').eq('provider_id', providerId!).in('status', ACTIVE_BOOKING_STATUSES)
          .gte('start_at', dayStart.toISOString()).lte('start_at', dayEnd.toISOString()),
      ]);
      if (providerRes.error) throw providerRes.error;
      if (rulesRes.error) throw rulesRes.error;
      if (vacRes.error) throw vacRes.error;
      if (excRes.error) throw excRes.error;
      if (bookingsRes.error) throw bookingsRes.error;

      const provider = providerRes.data;
      if (provider.vacation_mode) return [];
      // Provider is on vacation this date — no slots at all.
      if ((vacRes.data ?? []).length > 0) return [];

      const exceptions = (excRes.data ?? []).filter((e: any) => e.is_blocked && (e.end_date ?? e.date) >= dateStr);
      // A full-day exception (no start/end time) blocks the whole date.
      if (exceptions.some((e: any) => !e.start_time || !e.end_time)) return [];

      const now = new Date();
      const earliestAllowed = new Date(now.getTime() + provider.min_notice_hours * 3600000);
      const latestAllowed = new Date(now.getTime() + provider.max_advance_days * 86400000);
      const bufferMs = provider.buffer_minutes * 60000;

      const rules = rulesRes.data ?? [];
      const booked = bookingsRes.data ?? [];
      const slots: { label: string; start: Date; end: Date }[] = [];

      for (const rule of rules) {
        const [sh, sm] = rule.start_time.split(':').map(Number);
        const [eh, em] = rule.end_time.split(':').map(Number);
        let cursor = new Date(d); cursor.setHours(sh, sm, 0, 0);
        const ruleEnd = new Date(d); ruleEnd.setHours(eh, em, 0, 0);

        while (+cursor + slotMinutes * 60000 <= +ruleEnd) {
          const slotEnd = new Date(+cursor + slotMinutes * 60000);
          const withinWindow = cursor >= earliestAllowed && cursor <= latestAllowed;
          const overlapsBooking = booked.some((b: any) => {
            const bs = new Date(+new Date(b.start_at) - bufferMs), be = new Date(+new Date(b.end_at) + bufferMs);
            return +cursor < +be && +slotEnd > +bs;
          });
          const overlapsException = exceptions.some((e: any) => {
            if (!e.start_time || !e.end_time) return true;
            const [xsh, xsm] = e.start_time.split(':').map(Number);
            const [xeh, xem] = e.end_time.split(':').map(Number);
            const xs = new Date(d); xs.setHours(xsh, xsm, 0, 0);
            const xe = new Date(d); xe.setHours(xeh, xem, 0, 0);
            return +cursor < +xe && +slotEnd > +xs;
          });
          if (withinWindow && !overlapsBooking && !overlapsException) {
            slots.push({
              label: cursor.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
              start: new Date(cursor),
              end: slotEnd,
            });
          }
          cursor = new Date(+cursor + slotMinutes * 60000);
        }
      }
      return slots;
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
        .select(`*, service:services(*), provider:providers(*, profile:profiles(full_name, avatar_url)), location:booking_locations(*)`)
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}



// ---------- Rescheduling ----------
export type RescheduleAction = 'accept' | 'reject' | 'counter';

export function useRescheduleRequests(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['reschedule-requests', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_reschedule_requests')
        .select('*')
        .eq('booking_id', bookingId!)
        .order('requested_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function invalidateRescheduleQueries(qc: ReturnType<typeof useQueryClient>, bookingId: string) {
  qc.invalidateQueries({ queryKey: ['reschedule-requests', bookingId] });
  qc.invalidateQueries({ queryKey: ['booking', bookingId] });
  qc.invalidateQueries({ queryKey: ['provider-booking', bookingId] });
  qc.invalidateQueries({ queryKey: ['my-bookings'] });
  qc.invalidateQueries({ queryKey: ['provider-bookings'] });
}

export function useRequestReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; proposedStart: string; proposedEnd: string; reason?: string }) => {
      const { data, error } = await supabase.rpc('request_reschedule', {
        p_booking_id: input.bookingId,
        p_proposed_start: input.proposedStart,
        p_proposed_end: input.proposedEnd,
        p_reason: input.reason ?? '',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => invalidateRescheduleQueries(qc, vars.bookingId),
  });
}

export function useRespondReschedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string; bookingId: string; action: RescheduleAction; reason?: string; counterStart?: string; counterEnd?: string;
    }) => {
      const { data, error } = await supabase.rpc('respond_reschedule', {
        p_request_id: input.requestId,
        p_action: input.action,
        p_reason: input.reason,
        p_counter_start: input.counterStart,
        p_counter_end: input.counterEnd,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => invalidateRescheduleQueries(qc, vars.bookingId),
  });
}

export function useCancelRescheduleRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; bookingId: string }) => {
      const { error } = await supabase.rpc('cancel_reschedule_request', { p_request_id: input.requestId });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidateRescheduleQueries(qc, vars.bookingId),
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
    mutationFn: async ({
      id,
      status,
      reason,
      noShowParty,
    }: {
      id: string;
      status: Tables['bookings']['Row']['status'];
      reason?: string;
      noShowParty?: 'customer' | 'provider';
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === 'cancelled' && reason) patch.cancellation_reason = reason;
      if (status === 'no_show') {
        patch.no_show_party = noShowParty;
        if (reason) patch.no_show_reason = reason;
      }
      if (status === 'disputed' && reason) patch.dispute_reason = reason;
      const { error } = await supabase.from('bookings').update(patch as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['booking', vars.id] });
      qc.invalidateQueries({ queryKey: ['payment', vars.id] });
    },
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

// Server-backed unread count (COUNT via RLS-scoped query, not a client tally).
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
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

// ---------- Support ----------
// Reads a real key from the existing `settings` table rather than
// hardcoding contact details in application code.
export function useSupportContact() {
  return useQuery({
    queryKey: ['support-contact'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'support_contact')
        .maybeSingle();
      if (error) throw error;
      return (data?.value as { phone?: string; whatsapp?: string; note?: string } | null) ?? null;
    },
  });
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

// The customer's own review for a specific booking (if already submitted) —
// drives the completed-booking screen so it shows the real submitted rating
// instead of always rendering a blank, editable rating widget.
export function useBookingReview(bookingId: string | undefined) {
  return useQuery({
    enabled: !!bookingId,
    queryKey: ['booking-review', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('booking_id', bookingId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; providerId: string; rating: number; comment?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { data, error } = await supabase
        .from('reviews')
        .insert({
          booking_id: input.bookingId,
          provider_id: input.providerId,
          customer_id: user.id,
          rating: input.rating,
          comment: input.comment || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['booking-review', vars.bookingId] });
    },
  });
}

// ---------- Provider services (for booking) ----------
export function useProviderServices(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ['provider-services', providerId],
    queryFn: async () => {
      // `!inner` on the services join is required for `.eq('service.is_active', ...)`
      // below to actually filter — a plain left-embed ignores nested-column
      // filters. An inactive service must never be selectable for a new
      // booking, even if the provider's own offering of it is still approved.
      const { data, error } = await (supabase
        .from('provider_services')
        .select('price_override, status, service:services!inner(*, category:categories(slug, name_en, name_ar))') as any)
        .eq('provider_id', providerId!)
        .eq('status', 'approved')
        .eq('service.is_active', true);
      if (error) throw error;
      return (data ?? []) as any[];
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

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------- Notification preferences ----------
export type NotificationPreferences = {
  user_id: string;
  booking_push: boolean;
  chat_push: boolean;
  reminder_push: boolean;
  support_push: boolean;
  campaign_push: boolean;
  campaign_in_app: boolean;
};

const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, 'user_id'> = {
  booking_push: true,
  chat_push: true,
  reminder_push: true,
  support_push: true,
  campaign_push: false,
  campaign_in_app: true,
};

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { user_id: user.id, ...DEFAULT_NOTIFICATION_PREFERENCES }) as NotificationPreferences;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<NotificationPreferences, 'user_id'>>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('auth required');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });
}

// ---------- Push subscriptions ----------
export function useMyPushSubscriptions() {
  return useQuery({
    queryKey: ['push-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, device_label, created_at, last_seen_at, revoked_at')
        .is('revoked_at', null)
        .order('last_seen_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRegisterPushSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { endpoint: string; p256dh: string; authKey: string; deviceLabel?: string }) => {
      const { error } = await supabase.rpc('register_push_subscription', {
        p_endpoint: input.endpoint,
        p_p256dh: input.p256dh,
        p_auth_key: input.authKey,
        p_device_label: input.deviceLabel,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-subscriptions'] }),
  });
}

export function useRevokePushSubscriptionByEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (endpoint: string) => {
      const { error } = await supabase.rpc('revoke_push_subscription', { p_endpoint: endpoint });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-subscriptions'] }),
  });
}

export function useRevokePushSubscriptionById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_push_subscription_by_id', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-subscriptions'] }),
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

