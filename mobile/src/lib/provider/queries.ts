import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { aggregateProviderEarnings } from "@shared/earnings/aggregateProviderEarnings";
import { withCustomerParties } from "./parties";

export function useMyProvider() {
  return useQuery({
    queryKey: ["my-provider"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return null;
      const { data, error } = await supabase
        .from("providers")
        .select(
          `id, profile_id, bio_en, bio_ar, years_experience, hourly_rate, city, country, languages, is_active, is_verified, is_top_pro, vacation_mode, onboarding_status, submitted_at, review_reason_public, review_reason_code, buffer_minutes, min_notice_hours, max_advance_days, created_at, profile:profiles(*), ratings:ratings_summary(*)`,
        )
        .eq("profile_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("auth required");
      const { error } = await supabase.from("providers").update(patch).eq("profile_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-provider"] }),
  });
}

export function useProNotifications() {
  return useQuery({
    queryKey: ["pro-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProUnreadNotificationCount() {
  return useQuery({
    queryKey: ["pro-notifications", "unread-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useProviderBookings(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-bookings", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          `*, service:services(*), customer:profiles!bookings_customer_id_fkey(full_name, avatar_url, phone), location:booking_locations(*)`,
        )
        .eq("provider_id", providerId!)
        .order("start_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return withCustomerParties(data ?? []);
    },
  });
}

export function useProviderBooking(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["provider-booking", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          `*, service:services(*), customer:profiles!bookings_customer_id_fkey(full_name, avatar_url, phone), location:booking_locations(*), requirement_choices:booking_requirement_selections(*), family_member:booking_family_member_snapshots(*)`,
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data ? (await withCustomerParties([data]))[0] : data;
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
    }: {
      id: string;
      status: string;
      reason?: string;
      noShowParty?: "customer" | "provider";
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "cancelled" && reason) patch.cancellation_reason = reason;
      if (status === "no_show") {
        patch.no_show_party = noShowParty;
        if (reason) patch.no_show_reason = reason;
      }
      const { error } = await supabase.from("bookings").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["provider-bookings"] });
      qc.invalidateQueries({ queryKey: ["provider-booking", vars.id] });
      qc.invalidateQueries({ queryKey: ["provider-earnings"] });
      qc.invalidateQueries({ queryKey: ["payment", vars.id] });
    },
  });
}

export function useProviderEarnings(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-earnings", providerId],
    queryFn: async () => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select(
          "id, price_subtotal, price_extras_total, price_travel_fee, price_provider_net, price_commission_percent, price_commission_amount, start_at, status, payments(status, amount, captured_at)",
        )
        .eq("provider_id", providerId!);
      if (error) throw error;
      return aggregateProviderEarnings(bookings ?? []);
    },
  });
}

export function useProviderAvailability(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["provider-availability", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_rules")
        .select("*")
        .eq("provider_id", providerId!)
        .order("weekday");
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
      const { error } = await supabase.rpc("replace_provider_availability", {
        p_provider_id: providerId,
        p_rules: rules,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["provider-availability", vars.providerId] }),
  });
}

export function useMyProviderServices(providerId: string | undefined) {
  return useQuery({
    enabled: !!providerId,
    queryKey: ["my-provider-services", providerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_services")
        .select(
          "service_id, price_override, status, service:services(id, name_en, name_ar, is_active)",
        )
        .eq("provider_id", providerId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}
